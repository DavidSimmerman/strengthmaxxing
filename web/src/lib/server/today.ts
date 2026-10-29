/**
 * Server side of the dynamic coach: gathers recent sets, the library and coach settings from
 * the DB and hands them to the pure engine in $lib/coach. Runs from Apple Health arrive later
 * via healthmaxxing; until then `activities` is empty.
 */
import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { exercises, sessions, sessionSets } from '$lib/db/schema';
import { buildDay, type DayPlan } from '$lib/coach/build';
import { DAVID_TIERS, type Activity, type CheckIn, type CoachSettings, type LoggedSet, type Tier } from '$lib/coach/engine';
import { MUSCLES, type Muscle } from '$lib/coach/muscles';
import * as repo from './repo';
import { getProfile } from './coach';
import { isoDay } from '$lib/ui';

/** Coach settings live in the profile JSON under `dynamic`; defaults are David's priorities. */
export function coachSettings(): CoachSettings {
	const p = (repo.getSettings().profile ?? {}) as { dynamic?: Partial<CoachSettings> };
	const d = p.dynamic ?? {};
	const tiers = { ...DAVID_TIERS, ...(d.tiers ?? {}) } as Record<Muscle, Tier>;
	// Cutting unless told otherwise: on by default while yesterday's balance is a real deficit.
	const r = repo.getReadiness(isoDay(new Date(Date.now() - 864e5)));
	const cutting = d.cutting ?? (r?.kcalBalance != null ? r.kcalBalance < -300 : true);
	return { tiers, cutting, tauH: d.tauH ?? {}, lagBonus: d.lagBonus ?? {} };
}

/** Working and warm-up sets from the last 6 weeks, oldest first. RPE taps become RIR (10 − RPE). */
export function recentSets(now = new Date()): LoggedSet[] {
	const since = new Date(now.getTime() - 42 * 864e5);
	return db
		.select({
			at: sessionSets.completedAt,
			exercise: exercises.name,
			muscle: exercises.muscle,
			reps: sessionSets.reps,
			weightKg: sessionSets.weightKg,
			rpe: sessionSets.rpe,
			isWarmup: sessionSets.isWarmup,
			sessionId: sessionSets.sessionId
		})
		.from(sessionSets)
		.innerJoin(sessions, eq(sessionSets.sessionId, sessions.id))
		.innerJoin(exercises, eq(sessionSets.exerciseId, exercises.id))
		.where(and(gte(sessions.startedAt, since)))
		.orderBy(sessionSets.completedAt)
		.all()
		.map(({ rpe, ...s }) => ({ ...s, rir: rpe != null ? Math.max(0, 10 - rpe) : null }));
}

export function planToday(checkIn: CheckIn, activities: Activity[] = [], now = new Date()): DayPlan {
	const profile = getProfile();
	return buildDay({
		now,
		sets: recentSets(now),
		activities,
		library: repo
			.listExercises()
			.filter((e) => hasEquipment(e.name, e.category, profile.equipment ?? []))
			.map((e) => ({ name: e.name, muscle: e.muscle, category: e.category })),
		dislikes: profile.dislikes,
		checkIn,
		settings: coachSettings()
	});
}

/**
 * Can the lifter do this exercise with the equipment in their profile (free text like
 * "cable stack, SelectTech dumbbells, Smith machine")? No list = everything is allowed.
 */
export function hasEquipment(name: string, category: string, equipment: string[]): boolean {
	if (!equipment.length) return true;
	const have = equipment.join(' ').toLowerCase();
	const needs: Record<string, string[]> = {
		'Pull-Up': ['pull-up', 'pullup', 'chin-up bar'],
		'Chin-Up': ['pull-up', 'pullup', 'chin-up bar'],
		'Hanging Leg Raise': ['pull-up', 'pullup', 'chin-up bar'],
		Dip: ['dip']
	};
	if (needs[name]) return needs[name].some((k) => have.includes(k));
	if (category === 'bodyweight') return true;
	if (category === 'smith machine') return have.includes('smith');
	if (category === 'machine') return /machine|leg press|leg ext|leg curl|pec deck|preacher|hack/.test(have.replaceAll('smith machine', ''));
	return have.includes(category === 'dumbbell' ? 'dumbbell' : category);
}

export const isMuscle = (m: string): m is Muscle => (MUSCLES as readonly string[]).includes(m);
