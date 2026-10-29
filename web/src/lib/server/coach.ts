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
import { EQUIPMENT_ROUNDING } from '$lib/equipment';
import { estimateSoreness, muscleArea } from './soreness';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export const AGENT_URL = env.AGENT_URL || 'http://localhost:8787';

export type CoachProfile = {
	goal?: string; // strength | hypertrophy | powerbuilding | fat loss | general
	daysPerWeek?: number;
	sessionMin?: number;
	experience?: string;
	equipment?: string[];
	avoid?: string; // injuries / exercises to avoid, free text
	dislikes?: string[]; // exercise names the coach must never program
	notes?: string; // anything else, free text
};

export type ActiveProgram = {
	name: string;
	weeks: number | null; // null = open-ended repeating cycle
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
	perSide?: boolean; // one arm / leg at a time
	notes?: string;
};
export type CoachPlan = {
	name: string;
	weeks: number | null; // null = open-ended repeating cycle
	deloadWeek: number | null;
	progression: string;
	days: { name: string; dayOfWeek?: string | null; estMinutes: number; exercises: PlanExercise[] }[];
};

/** Our own time estimate for a day: ~1 min per set + its rest, + 5 min warm-up/changeovers. */
export function dayMinutes(exercises: { sets: number; restSec: number; perSide?: boolean }[]) {
	return Math.round(5 + exercises.reduce((m, x) => m + x.sets * ((x.perSide ? 120 : 60) + x.restSec), 0) / 60);
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Is this exercise on the lifter's dislike list? */
export function isDisliked(name: string, profile: CoachProfile = getProfile()) {
	return (profile.dislikes ?? []).some((d) => normName(d) === normName(name));
}

/** The exercise library as the coach sees it ("Name [equipment]"), minus disliked exercises. */
export function coachLibrary() {
	const profile = getProfile();
	return repo
		.listExercises()
		.filter((e) => !isDisliked(e.name, profile))
		.map((e) => `${e.name} [${e.category}]`);
}

/** Objective problems with a plan that the model is asked to fix (one retry). */
export function planProblems(plan: CoachPlan, profile: CoachProfile): string[] {
	const out: string[] = [];
	const max = profile.sessionMin;
	for (const d of plan.days) {
		const min = dayMinutes(d.exercises);
		if (max && min > max + 5)
			out.push(`"${d.name}" takes about ${min} minutes (sets × (1 min + rest) + 5), over their ${max}-minute limit.`);
	}
	const unknown = plan.days.flatMap((d) => d.exercises.filter((x) => !x.exerciseId).map((x) => x.name));
	if (unknown.length) out.push(`Not in the exercise library (use only library names): ${unknown.join(', ')}.`);
	const disliked = plan.days.flatMap((d) => d.exercises.filter((x) => isDisliked(x.name, profile)).map((x) => x.name));
	if (disliked.length) out.push(`They dislike these exercises; replace them: ${[...new Set(disliked)].join(', ')}.`);
	return out;
}

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
		weeks: Number(p.weeks) > 0 ? Number(p.weeks) : null,
		deloadWeek: p.deloadWeek == null ? null : Number(p.deloadWeek),
		progression: String(p.progression ?? ''),
		days: p.days.map((d) => ({
			name: String(d.name),
			dayOfWeek: d.dayOfWeek ?? null,
			estMinutes: 0,
			exercises: (d.exercises ?? []).map((x) => ({
				name: String(x.name).replace(/\s*\[[^\]]*\]\s*$/, ''), // model may echo "[equipment]"
				exerciseId: byName.get(norm(String(x.name).replace(/\s*\[[^\]]*\]\s*$/, ''))) ?? null,
				sets: Math.max(1, Math.round(Number(x.sets) || 3)),
				reps: Math.max(1, Math.round(Number(x.reps) || 8)),
				restSec: Math.max(15, Math.round(Number(x.restSec) || 90)),
				weightKg: x.weightKg == null || !Number.isFinite(Number(x.weightKg)) ? null : Number(x.weightKg),
				perSide: x.perSide === true,
				notes: x.notes ? String(x.notes) : undefined
			}))
		})).map((d) => ({ ...d, estMinutes: dayMinutes(d.exercises) }))
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
					restSec: x.restSec,
					perSide: x.perSide ?? false
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
	if (!p.weeks) return null;
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

/**
 * POST to the coach agent. Plain node:http, not fetch: research turns run longer than fetch's
 * fixed 5-minute wait for response headers. `_fetchFn` is kept for call-site compatibility.
 */
export function callAgent(path: '/plan' | '/progress' | '/review' | '/live' | '/note', body: unknown, _fetchFn?: typeof fetch) {
	const url = new URL(path, AGENT_URL);
	// every request carries how weights round on this equipment
	const payload = JSON.stringify({ rounding: EQUIPMENT_ROUNDING, ...(body as object) });
	const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
	return new Promise<Record<string, unknown>>((resolve, reject) => {
		const req = send(
			url,
			{ method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } },
			(res) => {
				let raw = '';
				res.setEncoding('utf8');
				res.on('data', (c) => (raw += c));
				res.on('end', () => {
					let data: Record<string, unknown> | null = null;
					try {
						data = JSON.parse(raw);
					} catch {
						/* handled below */
					}
					if (!res.statusCode || res.statusCode >= 400 || !data)
						return reject(new Error((data?.error as string) ?? `coach agent error (${res.statusCode})`));
					resolve(data);
				});
			}
		);
		req.setTimeout(20 * 60_000, () => req.destroy(new Error('coach agent timed out')));
		req.on('error', reject);
		req.end(payload);
	});
}


const TIME_OF_DAY = (h: number) => (h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night');

/**
 * Suggested weight × reps for each exercise of a workout: last time's sets + today's check-in
 * (energy, soreness per area) + estimated soreness + standing preferences → agent /progress.
 */
export async function progressFor(
	workoutId: number,
	_fetchFn?: typeof fetch,
	date = isoDay(),
	opts: { checkin?: Checkin | null; excludeSessionId?: number } = {}
) {
	const workout = repo.getWorkout(workoutId);
	if (!workout) return null;
	const last = repo.lastPerformance(
		workout.exercises.map((we) => we.exerciseId),
		opts.excludeSessionId ?? -1
	);
	const now = Date.now();
	const exercises = workout.exercises.map((we) => {
		const lt = last.get(we.exerciseId);
		return {
			name: we.exercise.name,
			area: muscleArea(we.exercise.muscle),
			equipment: we.exercise.category,
			targetSets: we.targetSets,
			targetReps: we.targetReps,
			perSide: we.perSide,
			plannedWeightKg: we.targetWeightKg || null,
			lastTime: lt
				? { daysAgo: Math.round((now - new Date(lt.date).getTime()) / 864e5), sets: lt.sets }
				: null
		};
	});
	const r = repo.getReadiness(date);
	const program = getActiveProgram();
	const data = await callAgent('/progress', {
		units: repo.getSettings().units,
		profile: getProfile(),
		program: program ? { name: program.name, progression: program.progression } : null,
		checkin: opts.checkin ?? null,
		sorenessEstimate: Object.fromEntries(Object.entries(estimateSoreness()).map(([a, v]) => [a, v.level])),
		readiness: r?.score ?? null,
		context: {
			timeOfDay: TIME_OF_DAY(new Date().getHours()),
			kcalBalance: r?.kcalBalance ?? null,
			sleepHours: r?.sleepHours ?? null,
			sorenessNote: r?.sorenessNote ?? null
		},
		workout: { name: workout.name, exercises }
	});
	return {
		workout,
		readiness: r?.score ?? null,
		adjustments: (Array.isArray(data.adjustments) ? data.adjustments : []) as Adjustment[],
		summary: String(data.summary ?? '')
	};
}

export type Checkin = { energy: number | null; soreness: Record<string, number> };

export type SessionSuggestions = {
	status: 'pending' | 'ready' | 'error';
	at: string;
	summary?: string;
	error?: string;
	// keyed by exerciseId
	items?: Record<string, { weightKg: number; reps: number; kind: 'up' | 'hold' | 'down'; reason: string; sets?: number }>;
};

/** Ask the coach for this session's weights and store them on the session (runs in the background). */
export async function suggestForSession(sessionId: number) {
	const s = repo.getSession(sessionId);
	if (!s?.workoutId) return;
	const set = (v: SessionSuggestions) => repo.setSessionSuggestions(sessionId, v);
	set({ status: 'pending', at: new Date().toISOString() });
	try {
		const r = await progressFor(s.workoutId, undefined, isoDay(), {
			checkin: s.checkin ?? null,
			excludeSessionId: sessionId
		});
		if (!r) throw new Error('workout not found');
		const byName = new Map(r.workout.exercises.map((we) => [we.exercise.name, we.exerciseId]));
		const items: NonNullable<SessionSuggestions['items']> = {};
		for (const a of r.adjustments) {
			const id = byName.get(a.name);
			const w = Number(a.suggestedWeightKg);
			const reps = Math.round(Number(a.suggestedReps));
			if (!id || !Number.isFinite(w) || w < 0 || !(reps > 0)) continue;
			const kind = a.kind === 'up' || a.kind === 'down' ? a.kind : 'hold';
			items[id] = { weightKg: w, reps, kind, reason: String(a.reason ?? '').slice(0, 300) };
		}
		set({ status: 'ready', at: new Date().toISOString(), summary: r.summary, items });
	} catch (e) {
		set({ status: 'error', at: new Date().toISOString(), error: e instanceof Error ? e.message : 'coach unavailable' });
	}
}

export type Adjustment = {
	name: string;
	suggestedWeightKg: number;
	suggestedReps: number;
	kind?: 'up' | 'hold' | 'down';
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
	sources?: { title: string; url: string }[];
	saved?: boolean;
	progress?: {
		workoutId: number;
		workoutName: string;
		readiness: number | null;
		adjustments: Adjustment[];
	};
	applied?: string[]; // names of adjustments applied
	workoutEdit?: WorkoutEdit;
	editSaved?: boolean;
};

type EditExercise = {
	name: string;
	exerciseId: number | null;
	sets: number;
	reps: number;
	restSec: number;
	weightKg: number | null;
	perSide?: boolean;
};
export type WorkoutEdit = { workoutId: number; workoutName: string; before: EditExercise[]; after: EditExercise[] };

/** Saved workouts as the coach sees them (for "change X in Pull A"). */
export function workoutsBrief() {
	return repo.listWorkouts().map((w) => ({
		id: w.id,
		name: w.name,
		exercises: w.exercises.map((we) => ({
			name: we.exercise.name,
			sets: we.targetSets,
			reps: we.targetReps,
			restSec: we.restSec,
			weightKg: we.targetWeightKg || null,
			perSide: we.perSide
		}))
	}));
}

/** Turn the model's workoutEdit into a before/after we can show and save; null if unusable. */
export function resolveWorkoutEdit(raw: unknown): WorkoutEdit | null {
	const e = raw as { workoutId?: unknown; exercises?: unknown } | null;
	if (!e || !Array.isArray(e.exercises)) return null;
	const w = repo.getWorkout(Number(e.workoutId));
	if (!w) return null;
	// reuse the plan resolver for name → library id mapping
	const mapped = resolvePlan({ name: w.name, days: [{ name: w.name, exercises: e.exercises }] });
	if (!mapped) return null;
	return {
		workoutId: w.id,
		workoutName: w.name,
		before: w.exercises.map((we) => ({
			name: we.exercise.name,
			exerciseId: we.exerciseId,
			sets: we.targetSets,
			reps: we.targetReps,
			restSec: we.restSec,
			weightKg: we.targetWeightKg || null,
			perSide: we.perSide
		})),
		after: mapped.days[0].exercises.map(({ notes: _n, ...x }) => x)
	};
}

/** Save an edit to its workout; keep the active program's copy of that day in step. */
export function applyWorkoutEdit(edit: WorkoutEdit) {
	repo.updateWorkout(edit.workoutId, {
		exercises: edit.after
			.filter((x) => x.exerciseId != null)
			.map((x, i) => ({
				exerciseId: x.exerciseId!,
				orderIndex: i,
				targetSets: x.sets,
				targetReps: x.reps,
				targetWeightKg: x.weightKg ?? 0,
				restSec: x.restSec,
				perSide: x.perSide ?? false
			}))
	});
	const p = getActiveProgram();
	const idx = p?.workoutIds.indexOf(edit.workoutId) ?? -1;
	if (p && idx >= 0 && p.plan.days[idx]) {
		const days = p.plan.days.map((d, i) =>
			i === idx ? { ...d, exercises: edit.after, estMinutes: dayMinutes(edit.after) } : d
		);
		setActiveProgram({ ...p, plan: { ...p.plan, days } });
	}
}
const CHAT_MAX = 60;

const PENDING_MAX_MS = 20 * 60_000; // research turns can take several minutes

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
