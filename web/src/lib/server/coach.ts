/**
 * Coach plumbing shared by the /api/coach/* routes: builds the lifter context the agent
 * needs (profile, history, exercise library) and maps the agent's plan back onto real
 * exercise ids so it can be saved as workouts.
 */
import { env } from '$env/dynamic/private';
import { gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { sessions } from '$lib/db/schema';
import { e1rm } from '$lib/metrics';
import * as repo from './repo';
import { isoDay } from '$lib/ui';

export const AGENT_URL = env.AGENT_URL || 'http://localhost:8787';

export type CoachProfile = {
	goal?: string; // strength | hypertrophy | powerbuilding | fat loss | general
	daysPerWeek?: number;
	sessionMin?: number;
	experience?: string;
	equipment?: string[];
	avoid?: string; // injuries / exercises to avoid, free text
	notes?: string; // anything else, free text
};

export type ActiveProgram = {
	name: string;
	weeks: number;
	deloadWeek: number | null;
	progression: string;
	startedAt: string; // ISO
	workoutIds: number[];
	plan: CoachPlan;
};

export type PlanExercise = {
	name: string;
	exerciseId: number | null; // null = model named something not in the library
	sets: number;
	reps: number;
	restSec: number;
	weightKg: number | null;
	notes?: string;
};
export type CoachPlan = {
	name: string;
	weeks: number;
	deloadWeek: number | null;
	progression: string;
	days: { name: string; dayOfWeek?: string; exercises: PlanExercise[] }[];
};

export function getProfile(): CoachProfile {
	const p = repo.getSettings().profile ?? {};
	const { activeProgram: _a, chat: _c, ...profile } = p as Record<string, unknown>;
	return profile as CoachProfile;
}

export function saveProfile(profile: CoachProfile) {
	const cur = repo.getSettings().profile ?? {};
	repo.patchSettings({ profile: { ...cur, ...profile } });
}

export function getActiveProgram(): ActiveProgram | null {
	return ((repo.getSettings().profile ?? {}) as { activeProgram?: ActiveProgram }).activeProgram ?? null;
}

function setActiveProgram(p: ActiveProgram | null) {
	const cur = repo.getSettings().profile ?? {};
	repo.patchSettings({ profile: { ...cur, activeProgram: p } });
}

/** Compact training history for the model: per-exercise bests and last top set. */
export function historySummary() {
	const exs = repo.listExercises();
	const perExercise = [];
	for (const ex of exs) {
		const h = repo.exerciseHistory(ex.id);
		if (!h || !h.sets.length) continue;
		const lastDay = h.sets.at(-1)!.sessionId;
		const lastTop = h.sets
			.filter((s) => s.sessionId === lastDay)
			.reduce((b, s) => (s.e1rm > b.e1rm ? s : b));
		perExercise.push({
			name: ex.name,
			sessions: new Set(h.sets.map((s) => s.sessionId)).size,
			bestE1rmKg: h.prs.bestE1rm?.e1rm ?? null,
			lastTopSet: { reps: lastTop.reps, weightKg: lastTop.weightKg, date: lastTop.date.toISOString().slice(0, 10) }
		});
	}
	const since = new Date(Date.now() - 28 * 864e5);
	const recent = db.select({ id: sessions.id }).from(sessions).where(gte(sessions.startedAt, since)).all();
	return {
		totalSessions: repo.listSessions(100000).length,
		sessionsLast28Days: recent.length,
		exercises: perExercise
	};
}

/** Map plan exercise names onto library ids (exact, then case/punctuation-insensitive). */
export function resolvePlan(raw: unknown): CoachPlan | null {
	const p = raw as Partial<CoachPlan> | null;
	if (!p || !Array.isArray(p.days)) return null;
	const lib = repo.listExercises();
	const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
	const byName = new Map(lib.map((e) => [norm(e.name), e.id]));
	return {
		name: String(p.name ?? 'Program'),
		weeks: Number(p.weeks) || 6,
		deloadWeek: p.deloadWeek == null ? null : Number(p.deloadWeek),
		progression: String(p.progression ?? ''),
		days: p.days.map((d) => ({
			name: String(d.name),
			dayOfWeek: d.dayOfWeek,
			exercises: (d.exercises ?? []).map((x) => ({
				name: String(x.name),
				exerciseId: byName.get(norm(String(x.name))) ?? null,
				sets: Math.max(1, Math.round(Number(x.sets) || 3)),
				reps: Math.max(1, Math.round(Number(x.reps) || 8)),
				restSec: Math.max(15, Math.round(Number(x.restSec) || 90)),
				weightKg: x.weightKg == null || !Number.isFinite(Number(x.weightKg)) ? null : Number(x.weightKg),
				notes: x.notes ? String(x.notes) : undefined
			}))
		}))
	};
}

/** Save each plan day as a workout template; remember it as the active program. */
export function saveProgram(plan: CoachPlan) {
	const old = getActiveProgram();
	const workoutIds = plan.days.map((d) =>
		repo.createWorkout({
			name: `${d.name}`,
			notes: `${plan.name}${d.dayOfWeek ? ` · ${d.dayOfWeek}` : ''}`,
			exercises: d.exercises
				.filter((x) => x.exerciseId != null)
				.map((x, i) => ({
					exerciseId: x.exerciseId!,
					orderIndex: i,
					targetSets: x.sets,
					targetReps: x.reps,
					targetWeightKg: x.weightKg ?? 0,
					restSec: x.restSec
				}))
		}).id
	);
	// the previous program's templates are retired so the workout list doesn't pile up
	for (const id of old?.workoutIds ?? []) repo.deleteWorkout(id);
	const program: ActiveProgram = {
		name: plan.name,
		weeks: plan.weeks,
		deloadWeek: plan.deloadWeek,
		progression: plan.progression,
		startedAt: new Date().toISOString(),
		workoutIds,
		plan
	};
	setActiveProgram(program);
	return program;
}

/** Current week of the active program, 1-based, capped at its length. */
export function programWeek(p: ActiveProgram, now = new Date()) {
	const w = Math.floor((now.getTime() - new Date(p.startedAt).getTime()) / (7 * 864e5)) + 1;
	return Math.min(Math.max(1, w), p.weeks);
}

/** Top set (best e1RM) from the most recent session that included the exercise. */
export function lastTopSet(exerciseId: number) {
	const h = repo.exerciseHistory(exerciseId);
	if (!h?.sets.length) return null;
	const lastDay = h.sets.at(-1)!.sessionId;
	return h.sets.filter((s) => s.sessionId === lastDay).reduce((b, s) => (e1rm(s.weightKg, s.reps) > e1rm(b.weightKg, b.reps) ? s : b));
}

export async function callAgent(path: '/plan' | '/progress', body: unknown, fetchFn: typeof fetch) {
	const res = await fetchFn(`${AGENT_URL}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => null);
	if (!res.ok) throw new Error((data as { error?: string } | null)?.error ?? `coach agent error (${res.status})`);
	return data as Record<string, unknown>;
}


const TIME_OF_DAY = (h: number) => (h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night');

/** Suggested weights for one workout: last top sets + today's readiness → agent /progress. */
export async function progressFor(workoutId: number, fetchFn: typeof fetch, date = isoDay()) {
	const workout = repo.getWorkout(workoutId);
	if (!workout) return null;
	// Per exercise: the top set (best e1RM) of the last session that included it — not merely
	// the latest set, which is often a lighter back-off set.
	const exercises = workout.exercises.map((we) => {
		const last = lastTopSet(we.exerciseId);
		return {
			name: we.exercise.name,
			lastWeightKg: last?.weightKg ?? null,
			lastReps: last?.reps ?? null,
			targetWeightKg: we.targetWeightKg || null,
			targetReps: we.targetReps
		};
	});
	const r = repo.getReadiness(date);
	const data = await callAgent(
		'/progress',
		{
			workout: { name: workout.name, exercises },
			readiness: r?.score ?? null,
			units: repo.getSettings().units,
			context: {
				timeOfDay: TIME_OF_DAY(new Date().getHours()),
				kcalBalance: r?.kcalBalance ?? null,
				sleepHours: r?.sleepHours ?? null,
				sorenessNote: r?.sorenessNote ?? null
			}
		},
		fetchFn
	);
	return {
		workout,
		readiness: r?.score ?? null,
		adjustments: (Array.isArray(data.adjustments) ? data.adjustments : []) as Adjustment[],
		summary: String(data.summary ?? '')
	};
}

export type Adjustment = {
	name: string;
	suggestedWeightKg: number;
	suggestedReps: number;
	deltaPct: number;
	reason: string;
};

/** The workout to do next: the one after the last-trained workout of the active program. */
export function nextWorkoutId(): number | null {
	const p = getActiveProgram();
	const ids = p?.workoutIds ?? [];
	if (!ids.length) return repo.listWorkouts()[0]?.id ?? null;
	const last = repo.listSessions(200).find((s) => s.workoutId != null && ids.includes(s.workoutId));
	return last ? ids[(ids.indexOf(last.workoutId!) + 1) % ids.length] : ids[0];
}

// ---------- chat (kept on the settings row, newest last, capped) ----------
export type ChatMessage = {
	id: string;
	role: 'user' | 'coach';
	text: string;
	at: string;
	error?: boolean;
	pending?: boolean; // coach still working (replies run in the background)
	plan?: CoachPlan;
	rationale?: string;
	saved?: boolean;
	progress?: {
		workoutId: number;
		workoutName: string;
		readiness: number | null;
		adjustments: Adjustment[];
	};
	applied?: string[]; // names of adjustments applied
};
const CHAT_MAX = 60;

const PENDING_MAX_MS = 6 * 60_000;

export function getChat(): ChatMessage[] {
	const chat = ((repo.getSettings().profile ?? {}) as { chat?: ChatMessage[] }).chat ?? [];
	// A reply the server lost (restart mid-request) would spin forever — give up on it.
	const now = Date.now();
	return chat.map((m) =>
		m.pending && now - Date.parse(m.at) > PENDING_MAX_MS
			? { ...m, pending: false, error: true, text: 'The coach took too long. Try again.' }
			: m
	);
}

function setChat(chat: ChatMessage[]) {
	const cur = repo.getSettings().profile ?? {};
	repo.patchSettings({ profile: { ...cur, chat: chat.slice(-CHAT_MAX) } });
}

export function appendChat(...msgs: Omit<ChatMessage, 'id' | 'at'>[]) {
	const out = msgs.map((m) => ({ ...m, id: crypto.randomUUID(), at: new Date().toISOString() }));
	setChat([...getChat(), ...out]);
	return out;
}

export function patchChat(id: string, patch: Partial<ChatMessage>) {
	setChat(getChat().map((m) => (m.id === id ? { ...m, ...patch } : m)));
}

export const clearChat = () => setChat([]);

/** Same exercises, sets, reps and weights → nothing to save. */
export function samePlan(a: CoachPlan, b: CoachPlan) {
	const key = (p: CoachPlan) =>
		JSON.stringify(p.days.map((d) => d.exercises.map((x) => [x.exerciseId, x.sets, x.reps, x.weightKg])));
	return key(a) === key(b);
}
