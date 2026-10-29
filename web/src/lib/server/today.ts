/**
 * Server side of the dynamic coach: gathers recent sets, the library and coach settings from
 * the DB and hands them to the pure engine in $lib/coach. Runs from Apple Health arrive later
 * via healthmaxxing; until then `activities` is empty.
 */
import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { exercises, sessions, sessionSets } from '$lib/db/schema';
import { buildDay, type DayPlan, type PlannedExercise } from '$lib/coach/build';
import {
	DAVID_TIERS,
	prescribe,
	readiness,
	warmupsFor,
	type Activity,
	type CheckIn,
	type CoachSettings,
	type History,
	type LoggedSet,
	type Soreness,
	type Tier
} from '$lib/coach/engine';
import { LEG_MUSCLES, MUSCLES, primaryMuscle, profileFor, type Muscle } from '$lib/coach/muscles';
import * as repo from './repo';
import { callAgent, getProfile } from './coach';
import { isoDay } from '$lib/ui';
import { feedActivities, feedCutting, healthFeed } from './healthfeed';

/** Coach settings live in the profile JSON under `dynamic`; defaults are David's priorities. */
export function coachSettings(cuttingHint: boolean | null = null): CoachSettings {
	const p = (repo.getSettings().profile ?? {}) as { dynamic?: Partial<CoachSettings> };
	const d = p.dynamic ?? {};
	const tiers = { ...DAVID_TIERS, ...(d.tiers ?? {}) } as Record<Muscle, Tier>;
	// Cutting unless told otherwise: on by default while yesterday's balance is a real deficit.
	const r = repo.getReadiness(isoDay(new Date(Date.now() - 864e5)));
	const cutting = d.cutting ?? cuttingHint ?? (r?.kcalBalance != null ? r.kcalBalance < -300 : true);
	return { tiers, cutting, tauH: d.tauH ?? {}, lagBonus: d.lagBonus ?? {} };
}

/** Working and warm-up sets from the last 6 weeks, oldest first. RPE taps become RIR (10 − RPE). */
export function recentSets(now = new Date()): LoggedSet[] {
	const since = new Date(now.getTime() - 42 * 864e5);
	return db
		.select({
			completedAt: sessionSets.completedAt,
			startedAt: sessions.startedAt,
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
		.orderBy(sessions.startedAt, sessionSets.completedAt)
		.all()
		// A set synced late (offline watch, backfill) is stamped when it arrived; cap it at the
		// session's start + 4 h so old work doesn't look fresh.
		.map(({ rpe, completedAt, startedAt, ...s }) => ({
			...s,
			at: new Date(Math.min(completedAt.getTime(), startedAt.getTime() + 4 * 3600_000)),
			rir: rpe != null ? Math.max(0, 10 - rpe) : null
		}));
}

/** Today's plan with other training and the diet goal from healthmaxxing (when linked). */
export async function planTodayLive(checkIn: CheckIn): Promise<DayPlan> {
	const feed = await healthFeed();
	return planToday(checkIn, feedActivities(feed), new Date(), feedCutting(feed));
}

export function planToday(checkIn: CheckIn, activities: Activity[] = [], now = new Date(), cuttingHint: boolean | null = null): DayPlan {
	const profile = getProfile();
	// Reported pain keeps those muscles lighter for a week (treated as at least "a bit sore").
	const soreness = { ...checkIn.soreness };
	for (const inj of activeInjuries(now)) for (const m of inj.muscles) soreness[m] = Math.max(soreness[m] ?? 0, 1) as 1 | 2;
	checkIn = { ...checkIn, soreness };
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
		settings: coachSettings(cuttingHint)
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
	// Brand names and shorthand count too ("Bowflex SelectTech", "DBs", "cable stack").
	const words: Record<string, string[]> = {
		dumbbell: ['dumbbell', 'dumbell', 'selecttech', 'bowflex', 'db'],
		cable: ['cable', 'pulley', 'functional trainer'],
		barbell: ['barbell', 'olympic bar', 'squat rack', 'power rack'],
		kettlebell: ['kettlebell', 'kb']
	};
	return (words[category] ?? [category]).some((w) => new RegExp(`\\b${w}`).test(have));
}

export const isMuscle = (m: string): m is Muscle => (MUSCLES as readonly string[]).includes(m);

// ---------- check-in ----------

/** Soreness tiles on the check-in (core is one tile for abs + obliques). */
export const TILES: { key: string; label: string; muscles: Muscle[] }[] = [
	{ key: 'chest', label: 'Chest', muscles: ['chest'] },
	{ key: 'upperBack', label: 'Upper back', muscles: ['upperBack'] },
	{ key: 'lats', label: 'Lats', muscles: ['lats'] },
	{ key: 'frontDelts', label: 'Front delts', muscles: ['frontDelts'] },
	{ key: 'sideDelts', label: 'Side delts', muscles: ['sideDelts'] },
	{ key: 'rearDelts', label: 'Rear delts', muscles: ['rearDelts'] },
	{ key: 'biceps', label: 'Biceps', muscles: ['biceps'] },
	{ key: 'triceps', label: 'Triceps', muscles: ['triceps'] },
	{ key: 'core', label: 'Core', muscles: ['abs', 'obliques'] },
	{ key: 'quads', label: 'Quads', muscles: ['quads'] },
	{ key: 'hamstrings', label: 'Hamstrings', muscles: ['hamstrings'] },
	{ key: 'glutes', label: 'Glutes', muscles: ['glutes'] },
	{ key: 'calves', label: 'Calves', muscles: ['calves'] }
];

/**
 * Pre-filled soreness per tile, guessed from leftover fatigue (soreness ≠ fatigue, so it is only
 * a starting point the lifter corrects), with a "Yesterday · 10 sets" note.
 */
export function checkinTiles(activities: Activity[] = [], now = new Date()) {
	const sets = recentSets(now);
	const ready = readiness(sets, activities, now, coachSettings().tauH);
	return TILES.map((t) => {
		const r = Math.min(...t.muscles.map((m) => ready[m]));
		const level = r < 0.3 ? 2 : r < 0.6 ? 1 : 0;
		// The most recent session that worked this tile, and its hard sets for it.
		const hits = sets.filter(
			(s) => !s.isWarmup && t.muscles.some((m) => (profileFor(s.exercise, s.muscle).credits[m] ?? 0) >= 0.5)
		);
		const last = hits.at(-1);
		let note = 'Ready';
		if (last && now.getTime() - last.at.getTime() < 4 * 864e5) {
			const n = hits.filter((s) => s.sessionId === last.sessionId).length;
			note = `${daysAgo(last.at, now)} · ${n} set${n === 1 ? '' : 's'}`;
		}
		const run = activities.filter((a) => /run/i.test(a.kind) && now.getTime() - a.at.getTime() < 2 * 864e5).at(-1);
		if (run && LEG_MUSCLES.some((m) => t.muscles.includes(m)) && note === 'Ready')
			note = `${daysAgo(run.at, now)}'s run`;
		return { ...t, level, note, readiness: Math.round(r * 100) };
	});
}

function daysAgo(at: Date, now: Date) {
	const d = Math.round((startOfDay(now) - startOfDay(at)) / 864e5);
	return d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`;
}
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Check-in soreness by tile key → by muscle. */
export function sorenessFromTiles(byTile: Record<string, number>): Soreness {
	const out: Soreness = {};
	for (const t of TILES) {
		const v = byTile[t.key];
		if (v === 1 || v === 2) for (const m of t.muscles) out[m] = v;
	}
	return out;
}

// ---------- session plan ----------

export type SessionPlanExercise = PlannedExercise & { exerciseId: number };
export type SessionPlan = Omit<DayPlan, 'exercises'> & {
	exercises: SessionPlanExercise[];
	summary: string | null;
	reviewed: boolean; // Claude reviewed the picks and wrote the reasons
	checkIn: CheckIn;
};

export function toSessionPlan(day: DayPlan, checkIn: CheckIn): SessionPlan {
	const ids = new Map(repo.listExercises().map((e) => [e.name, e.id]));
	return {
		...day,
		exercises: day.exercises.map((x) => ({ ...x, exerciseId: ids.get(x.exercise)! })),
		summary: null,
		reviewed: false,
		checkIn
	};
}

/**
 * Claude's pass over the engine's plan: may swap an exercise for another of the same muscle
 * (from the allowed list we send), writes the one-line reasons and a summary. Everything is
 * validated; anything off is ignored and the engine's version stands.
 */
export async function reviewPlan(plan: SessionPlan): Promise<SessionPlan> {
	const profile = getProfile();
	const lib = repo.listExercises().filter((e) => hasEquipment(e.name, e.category, profile.equipment ?? []));
	const disliked = new Set((profile.dislikes ?? []).map((d) => d.toLowerCase()));
	const inPlan = new Set(plan.exercises.map((x) => x.exercise));
	const alternatives = Object.fromEntries(
		plan.exercises.map((x) => [
			x.exercise,
			lib
				.filter((e) => !inPlan.has(e.name) && !disliked.has(e.name.toLowerCase()))
				.filter((e) => primaryMuscle(profileFor(e.name, e.muscle)) === x.forMuscle)
				.map((e) => e.name)
		])
	);
	const r = await callAgent('/review', {
		units: repo.getSettings().units,
		profile,
		checkIn: plan.checkIn,
		plan: {
			title: plan.title,
			minutes: plan.minutes,
			exercises: plan.exercises.map((x) => ({
				name: x.exercise,
				forMuscle: x.forMuscle,
				sets: x.sets,
				reps: `${x.repLow}-${x.repHigh}`,
				targetReps: x.targetReps,
				weightLb: x.weightLb,
				repsInReserve: x.rir,
				restSec: x.restSec,
				engineReason: x.reason
			})),
			resting: plan.resting,
			week: plan.week
		},
		alternatives
	});
	const items = Array.isArray(r.items) ? (r.items as { name?: string; swapTo?: string | null; reason?: string }[]) : [];
	const sets = recentSets();
	const history = new Map<string, ReturnType<typeof historyOf>>();
	const out: SessionPlanExercise[] = plan.exercises.map((x) => {
		const it = items.find((i) => i.name === x.exercise);
		if (!it) return x;
		const reason = typeof it.reason === 'string' && it.reason.trim() ? it.reason.trim().slice(0, 240) : x.reason;
		const swap = typeof it.swapTo === 'string' ? lib.find((e) => e.name === it.swapTo) : undefined;
		if (!swap || !alternatives[x.exercise]?.includes(swap.name)) return { ...x, reason };
		if (!history.has(swap.name)) history.set(swap.name, historyOf(sets, swap.name));
		const rx = prescribe(swap.name, swap.muscle, x.sets, history.get(swap.name)!, {
			category: swap.category,
			tier: coachSettings().tiers[x.forMuscle],
			energy: plan.checkIn.energy,
			sore: (plan.checkIn.soreness[x.forMuscle] ?? 0) as 0 | 1 | 2
		});
		return { ...x, ...rx, sets: x.sets, warmups: x.warmups.length && rx.weightLb ? warmupsFor(swap.category, rx.weightLb) : [], exercise: swap.name, exerciseId: swap.id, category: swap.category, reason };
	});
	const summary = typeof r.summary === 'string' ? r.summary.slice(0, 400) : null;
	return { ...plan, exercises: out, summary, reviewed: true };
}

/** Engine prescription for one exercise today (used for swaps: preview review, mid-workout chat). */
export function prescribeFor(
	ex: { name: string; muscle: string; category: string },
	forMuscle: Muscle,
	sets: number,
	checkIn: Pick<CheckIn, 'energy' | 'soreness'>
) {
	return prescribe(ex.name, ex.muscle, sets, historyOf(recentSets(), ex.name), {
		category: ex.category,
		tier: coachSettings().tiers[forMuscle],
		energy: checkIn.energy,
		sore: (checkIn.soreness[forMuscle] ?? 0) as 0 | 1 | 2
	});
}

export type Injury = { muscles: Muscle[]; note: string; until: string };

/** Pain the lifter reported mid-workout: those muscles count as "a bit sore" until it expires. */
export function activeInjuries(now = new Date()): Injury[] {
	const p = (repo.getSettings().profile ?? {}) as { dynamic?: { injuries?: Injury[] } };
	return (p.dynamic?.injuries ?? []).filter((i) => new Date(i.until) > now);
}

export function addInjury(muscles: Muscle[], note: string, days = 7) {
	const cur = (repo.getSettings().profile ?? {}) as Record<string, unknown> & { dynamic?: Record<string, unknown> & { injuries?: Injury[] } };
	const injuries = [...activeInjuries(), { muscles, note: note.slice(0, 200), until: new Date(Date.now() + days * 864e5).toISOString() }];
	repo.patchSettings({ profile: { ...cur, dynamic: { ...(cur.dynamic ?? {}), injuries } } });
}

function historyOf(sets: LoggedSet[], name: string): History {
	const by = new Map<number | string, History[number]>();
	for (const s of sets) {
		if (s.exercise !== name || s.isWarmup) continue;
		const k = s.sessionId ?? s.at.toDateString();
		const h = by.get(k) ?? { at: s.at, sets: [] };
		h.sets.push({ reps: s.reps, weightKg: s.weightKg, rir: s.rir });
		by.set(k, h);
	}
	return [...by.values()];
}

/** The plan as the session page's per-exercise suggestions (weight × reps + reason). */
export function planSuggestions(plan: SessionPlan) {
	const LB = 0.45359237;
	return Object.fromEntries(
		plan.exercises.map((x) => [
			x.exerciseId,
			{
				weightKg: (x.weightLb ?? 0) * LB,
				reps: x.targetReps,
				kind: x.kind === 'new' ? 'hold' : x.kind,
				reason: x.reason
			}
		])
	);
}
