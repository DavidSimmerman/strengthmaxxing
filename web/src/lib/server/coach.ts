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
	const { activeProgram: _, ...profile } = p as Record<string, unknown>;
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

