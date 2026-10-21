/**
 * The one place that touches the DB for mutations + derived reads.
 * Both the JSON API (routes/api) and the dashboard (+page.server actions) call these,
 * so business rules (rollups, export shape, fatigue math) live in exactly one spot.
 */
import { and, desc, eq, gte, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	exercises,
	workouts,
	workoutExercises,
	sessions,
	sessionSets,
	repEvents,
	readiness,
	settings,
	calibration,
	motionTraces
} from '$lib/db/schema';
import { e1rm, tonnage, repFatigue, estimateKcal, readinessScore } from '$lib/metrics';

// ---------- exercises ----------
export const listExercises = () => db.select().from(exercises).orderBy(exercises.muscle, exercises.name).all();

export function createExercise(input: {
	name: string;
	muscle: string;
	category: string;
	isBodyweight?: boolean;
	defaultRestSec?: number;
	met?: number;
}) {
	return db
		.insert(exercises)
		.values({
			name: input.name,
			muscle: input.muscle,
			category: input.category,
			isBodyweight: input.isBodyweight ?? input.category === 'bodyweight',
			defaultRestSec: input.defaultRestSec ?? 90,
			met: input.met ?? 5,
			isCustom: true
		})
		.returning()
		.get();
}

export const isUniqueError = (e: unknown) =>
	e instanceof Error && e.message.includes('UNIQUE constraint failed');

/** Every working set of one exercise, oldest first, plus all-time PRs. */
export function exerciseHistory(exerciseId: number) {
	const exercise = db.select().from(exercises).where(eq(exercises.id, exerciseId)).get();
	if (!exercise) return null;
	const rows = db
		.select({
			sessionId: sessionSets.sessionId,
			date: sessions.startedAt,
			reps: sessionSets.reps,
			weightKg: sessionSets.weightKg
		})
		.from(sessionSets)
		.innerJoin(sessions, eq(sessionSets.sessionId, sessions.id))
		.where(and(eq(sessionSets.exerciseId, exerciseId), eq(sessionSets.isWarmup, false)))
		.orderBy(sessions.startedAt, sessionSets.setIndex)
		.all();
	const sets = rows.map((r) => ({ ...r, e1rm: +e1rm(r.weightKg, r.reps).toFixed(1) }));
	// rep-max table: heaviest weight ever moved for at least N reps
	const repMax: Record<number, number> = {};
	for (const r of sets)
		for (const n of [1, 3, 5, 8, 10])
			if (r.reps >= n && r.weightKg > (repMax[n] ?? 0)) repMax[n] = r.weightKg;
	const best = sets.reduce<(typeof sets)[number] | null>((b, r) => (!b || r.e1rm > b.e1rm ? r : b), null);
	return { exercise, sets, prs: { bestE1rm: best, repMax } };
}

/** For each exercise: its working sets from the most recent other session ("last time"). */
export function lastPerformance(exerciseIds: number[], excludeSessionId: number) {
	const out = new Map<number, { date: Date; sets: { reps: number; weightKg: number }[] }>();
	for (const exerciseId of exerciseIds) {
		const last = db
			.select({ sessionId: sessionSets.sessionId, date: sessions.startedAt })
			.from(sessionSets)
			.innerJoin(sessions, eq(sessionSets.sessionId, sessions.id))
			.where(and(eq(sessionSets.exerciseId, exerciseId), ne(sessionSets.sessionId, excludeSessionId)))
			.orderBy(desc(sessions.startedAt))
			.limit(1)
			.get();
		if (!last) continue;
		const sets = db
			.select({ reps: sessionSets.reps, weightKg: sessionSets.weightKg })
			.from(sessionSets)
			.where(
				and(
					eq(sessionSets.sessionId, last.sessionId),
					eq(sessionSets.exerciseId, exerciseId),
					eq(sessionSets.isWarmup, false)
				)
			)
			.orderBy(sessionSets.setIndex)
			.all();
		out.set(exerciseId, { date: last.date, sets });
	}
	return out;
}

export function addSessionExercise(sessionId: number, exerciseId: number) {
	const s = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
	if (!s) return null;
	const ids = s.extraExerciseIds ?? [];
	if (!ids.includes(exerciseId))
		db.update(sessions).set({ extraExerciseIds: [...ids, exerciseId] }).where(eq(sessions.id, sessionId)).run();
	return true;
}

/** Best e1RM per exercise across all sets except those in `excludeSessionId`. */
export function bestE1rmByExercise(excludeSessionId?: number) {
	const rows = db
		.select({ exerciseId: sessionSets.exerciseId, reps: sessionSets.reps, weightKg: sessionSets.weightKg })
		.from(sessionSets)
		.where(
			excludeSessionId
				? and(eq(sessionSets.isWarmup, false), ne(sessionSets.sessionId, excludeSessionId))
				: eq(sessionSets.isWarmup, false)
		)
		.all();
	const best = new Map<number, number>();
	for (const r of rows) {
		const v = e1rm(r.weightKg, r.reps);
		if (v > (best.get(r.exerciseId) ?? 0)) best.set(r.exerciseId, v);
	}
	return best;
}

// ---------- workout templates ----------
export type WorkoutExerciseInput = {
	exerciseId: number;
	orderIndex?: number;
	supersetGroup?: number | null;
	targetSets?: number;
	targetReps?: number;
	targetWeightKg?: number;
	restSec?: number;
};

export function createWorkout(input: {
	name: string;
	notes?: string | null;
	exercises: WorkoutExerciseInput[];
}) {
	return db.transaction((tx) => {
		const w = tx
			.insert(workouts)
			.values({ name: input.name, notes: input.notes ?? null })
			.returning()
			.get();
		insertWorkoutExercises(tx, w.id, input.exercises);
		return w;
	});
}

export function updateWorkout(
	id: number,
	input: { name?: string; notes?: string | null; archived?: boolean; exercises?: WorkoutExerciseInput[] }
) {
	return db.transaction((tx) => {
		const patch: Record<string, unknown> = {};
		if (input.name !== undefined) patch.name = input.name;
		if (input.notes !== undefined) patch.notes = input.notes;
		if (input.archived !== undefined) patch.archived = input.archived;
		if (Object.keys(patch).length) tx.update(workouts).set(patch).where(eq(workouts.id, id)).run();
		if (input.exercises) {
			tx.delete(workoutExercises).where(eq(workoutExercises.workoutId, id)).run();
			insertWorkoutExercises(tx, id, input.exercises);
		}
		return getWorkout(id);
	});
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function insertWorkoutExercises(tx: Tx, workoutId: number, list: WorkoutExerciseInput[]) {
	if (!list?.length) return;
	tx.insert(workoutExercises)
		.values(
			list.map((e, i) => ({
				workoutId,
				exerciseId: e.exerciseId,
				orderIndex: e.orderIndex ?? i,
				supersetGroup: e.supersetGroup ?? null,
				targetSets: e.targetSets ?? 3,
				targetReps: e.targetReps ?? 8,
				targetWeightKg: e.targetWeightKg ?? 0,
				restSec: e.restSec ?? 120
			}))
		)
		.run();
}

export const listWorkouts = () =>
	db.query.workouts
		.findMany({
			where: eq(workouts.archived, false),
			orderBy: [desc(workouts.createdAt)],
			with: { exercises: { with: { exercise: true }, orderBy: [workoutExercises.orderIndex] } }
		})
		.sync();

export const getWorkout = (id: number) =>
	db.query.workouts
		.findFirst({
			where: eq(workouts.id, id),
			with: { exercises: { with: { exercise: true }, orderBy: [workoutExercises.orderIndex] } }
		})
		.sync();

export const deleteWorkout = (id: number) =>
	db.update(workouts).set({ archived: true }).where(eq(workouts.id, id)).run();

// ---------- sessions ----------
export function startSession(input: {
	workoutId?: number | null;
	name?: string;
	source?: string;
	bodyweightKg?: number | null;
	readinessScore?: number | null;
	clientId?: string | null;
	startedAt?: number | null; // epoch ms
}) {
	return db
		.insert(sessions)
		.values({
			clientId: input.clientId ?? null,
			...(input.startedAt ? { startedAt: new Date(input.startedAt) } : {}),
			workoutId: input.workoutId ?? null,
			name: input.name ?? 'Workout',
			source: input.source ?? 'web',
			bodyweightKg: input.bodyweightKg ?? null,
			readinessScore: input.readinessScore ?? null
		})
		.returning()
		.get();
}

export const findSessionByClientId = (clientId: string) =>
	db.select().from(sessions).where(eq(sessions.clientId, clientId)).get();

export const findSetByClientId = (clientId: string) =>
	db.select().from(sessionSets).where(eq(sessionSets.clientId, clientId)).get();

export type SetInput = {
	clientId?: string | null;
	exerciseId: number;
	setIndex?: number;
	supersetGroup?: number | null;
	reps: number;
	weightKg: number;
	rpe?: number | null;
	isWarmup?: boolean;
	restSecActual?: number | null;
	startedAt?: number | null; // epoch ms
	completedAt?: number | null; // epoch ms
	repEvents?: { repIndex: number; offsetMs: number; concentricMs?: number | null }[];
};

export function addSet(sessionId: number, input: SetInput) {
	const set = db.transaction((tx) => {
		const set = tx
			.insert(sessionSets)
			.values({
				clientId: input.clientId ?? null,
				sessionId,
				exerciseId: input.exerciseId,
				setIndex: input.setIndex ?? 0,
				supersetGroup: input.supersetGroup ?? null,
				reps: input.reps,
				weightKg: input.weightKg,
				rpe: input.rpe ?? null,
				isWarmup: input.isWarmup ?? false,
				restSecActual: input.restSecActual ?? null,
				startedAt: input.startedAt ? new Date(input.startedAt) : null,
				completedAt: input.completedAt ? new Date(input.completedAt) : new Date()
			})
			.returning()
			.get();
		if (input.repEvents?.length) {
			tx.insert(repEvents)
				.values(
					input.repEvents.map((r) => ({
						sessionSetId: set.id,
						repIndex: r.repIndex,
						offsetMs: r.offsetMs,
						concentricMs: r.concentricMs ?? null
					}))
				)
				.run();
		}
		return set;
	});
	recomputeIfFinished(sessionId);
	return set;
}

export function updateSet(
	sessionId: number,
	setId: number,
	patch: { reps?: number; weightKg?: number; rpe?: number | null; isWarmup?: boolean }
) {
	const row = db
		.update(sessionSets)
		.set(patch)
		.where(and(eq(sessionSets.id, setId), eq(sessionSets.sessionId, sessionId)))
		.returning()
		.get();
	if (row) recomputeIfFinished(sessionId);
	return row ?? null;
}

export function deleteSet(sessionId: number, setId: number) {
	const res = db
		.delete(sessionSets)
		.where(and(eq(sessionSets.id, setId), eq(sessionSets.sessionId, sessionId)))
		.run();
	if (res.changes) recomputeIfFinished(sessionId);
	return res.changes > 0;
}

/** Sets can change after finish (late watch sync, edits) — keep cached rollups true. */
function recomputeIfFinished(sessionId: number) {
	const s = db.select().from(sessions).where(eq(sessions.id, sessionId)).get();
	if (!s?.endedAt) return;
	const r = rollups(s, s.endedAt);
	// measured calories (watch / heart rate) stay; only the MET estimate follows the sets
	db.update(sessions)
		.set(s.kcalSource === 'estimate' ? r : { totalVolumeKg: r.totalVolumeKg })
		.where(eq(sessions.id, sessionId))
		.run();
}

export type MeasuredKcal = { activeKcal: number; avgHr?: number | null; kcalSource: 'apple_watch' | 'heart_rate' };

/** Finalize a session: stamp endedAt and cache tonnage + kcal rollups. */
export function finishSession(
	id: number,
	patch?: { notes?: string; bodyweightKg?: number; measured?: MeasuredKcal }
) {
	const s = db.select().from(sessions).where(eq(sessions.id, id)).get();
	if (!s) return null;
	const measured = patch?.measured
		? {
				estimatedKcal: Math.round(patch.measured.activeKcal),
				kcalSource: patch.measured.kcalSource,
				avgHr: patch.measured.avgHr ?? null
			}
		: null;
	// Idempotent: a duplicate /finish (client retry) must not restamp endedAt —
	// that would recompute duration to "now" and inflate the kcal estimate.
	// A repeat that carries measured calories (they arrive after the watch saves) is applied.
	if (s.endedAt) {
		if (!measured) return s;
		const { avgHr, ...rest } = measured;
		return db
			.update(sessions)
			.set(avgHr == null ? rest : measured) // a repeat without heart rate keeps the stored one
			.where(eq(sessions.id, id))
			.returning()
			.get();
	}
	const bw = patch?.bodyweightKg ?? s.bodyweightKg ?? 80;
	const endedAt = new Date();
	return db
		.update(sessions)
		.set({
			endedAt,
			...rollups({ ...s, bodyweightKg: bw }, endedAt),
			...measured,
			bodyweightKg: bw,
			notes: patch?.notes ?? s.notes
		})
		.where(eq(sessions.id, id))
		.returning()
		.get();
}

function rollups(s: typeof sessions.$inferSelect, endedAt: Date) {
	const id = s.id;
	const sets = db.select().from(sessionSets).where(eq(sessionSets.sessionId, id)).all();
	const working = sets.filter((x) => !x.isWarmup);
	const totalVolumeKg = tonnage(working);

	const bw = s.bodyweightKg ?? 80;
	const started = s.startedAt ?? endedAt;
	const totalMin = Math.max(1, (endedAt.getTime() - started.getTime()) / 60000);

	// per-set active minutes from timestamps, else ~3s/rep fallback.
	const exMet = new Map(db.select().from(exercises).all().map((e) => [e.id, e.met]));
	let activeMin = 0;
	const workingForKcal = sets.map((x) => {
		const dur =
			x.startedAt && x.completedAt
				? (x.completedAt.getTime() - x.startedAt.getTime()) / 60000
				: (x.reps * 3) / 60;
		activeMin += dur;
		return { met: exMet.get(x.exerciseId) ?? 5, activeMin: dur };
	});
	const restMin = Math.max(0, totalMin - activeMin);
	const estimatedKcal = estimateKcal(workingForKcal, restMin, bw);
	return { totalVolumeKg, estimatedKcal };
}

export const listSessions = (limit = 30) =>
	db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(limit).all();

export const getSession = (id: number) =>
	db.query.sessions
		.findFirst({
			where: eq(sessions.id, id),
			with: { sets: { with: { exercise: true, repEvents: true } }, workout: true }
		})
		.sync();

export const deleteSession = (id: number) => db.delete(sessions).where(eq(sessions.id, id)).run();

// SQLite FK violations surface as generic driver Errors; routes use this to
// map "referenced id doesn't exist" to a 400 instead of leaking a raw 500.
export const isFkError = (e: unknown) =>
	e instanceof Error && e.message.includes('FOREIGN KEY constraint failed');

// ---------- readiness ----------
export function upsertReadiness(
	date: string,
	input: {
		sleepHours?: number | null;
		kcalBalance?: number | null;
		proteinG?: number | null;
		sorenessNote?: string | null;
		sorenessLevel?: number | null;
		hrvMs?: number | null;
		hrvBaselineMs?: number | null;
		restingHr?: number | null;
		restingHrBaseline?: number | null;
	}
) {
	const score = readinessScore(input);
	const row = {
		date,
		sleepHours: input.sleepHours ?? null,
		kcalBalance: input.kcalBalance ?? null,
		proteinG: input.proteinG ?? null,
		sorenessNote: input.sorenessNote ?? null,
		hrvMs: input.hrvMs ?? null,
		restingHr: input.restingHr ?? null,
		score,
		updatedAt: new Date()
	};
	db.insert(readiness).values(row).onConflictDoUpdate({ target: readiness.date, set: row }).run();
	return row;
}

export const getReadiness = (date: string) =>
	db.select().from(readiness).where(eq(readiness.date, date)).get();

// ---------- export / analytics ----------
/** One session, fully enriched with derived metrics — the unit healthmaxxing consumes. */
export function sessionExport(id: number) {
	const s = getSession(id);
	if (!s) return null;
	const setDetails = s.sets.map((set) => {
		const offsets = [...set.repEvents].sort((a, b) => a.repIndex - b.repIndex).map((r) => r.offsetMs);
		return {
			exercise: set.exercise.name,
			muscle: set.exercise.muscle,
			setIndex: set.setIndex,
			reps: set.reps,
			weightKg: set.weightKg,
			rpe: set.rpe,
			isWarmup: set.isWarmup,
			supersetGroup: set.supersetGroup,
			e1rmKg: +e1rm(set.weightKg, set.reps).toFixed(1),
			restSecActual: set.restSecActual,
			fatigue: repFatigue(offsets),
			repTimeline: offsets
		};
	});
	const byMuscle: Record<string, number> = {};
	for (const set of s.sets)
		if (!set.isWarmup)
			byMuscle[set.exercise.muscle] = (byMuscle[set.exercise.muscle] ?? 0) + set.reps * set.weightKg;
	return {
		id: s.id,
		name: s.name,
		source: s.source,
		startedAt: s.startedAt,
		endedAt: s.endedAt,
		durationSec: s.endedAt && s.startedAt ? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000) : null,
		bodyweightKg: s.bodyweightKg,
		readinessScore: s.readinessScore,
		totalVolumeKg: s.totalVolumeKg,
		estimatedKcal: s.estimatedKcal,
		kcalSource: s.kcalSource,
		avgHr: s.avgHr,
		volumeByMuscle: byMuscle,
		sets: setDetails
	};
}

/** Everything since `sinceMs` (epoch ms), for the healthmaxxing bulk pull. */
export function fullExport(sinceMs?: number) {
	const rows = sinceMs
		? db.select({ id: sessions.id }).from(sessions).where(gte(sessions.startedAt, new Date(sinceMs))).all()
		: db.select({ id: sessions.id }).from(sessions).all();
	return {
		app: 'strengthmaxxing',
		exportedAt: new Date().toISOString(),
		sessions: rows.map((r) => sessionExport(r.id)).filter(Boolean)
	};
}

/**
 * Apple HealthKit HKWorkout payload for the iOS app to write to Apple Fitness.
 * The native app maps this into HKWorkoutBuilder — see ios/ for the Swift side.
 */
export function healthkitPayload(id: number) {
	const s = getSession(id);
	if (!s || !s.endedAt) return null;
	return {
		workoutActivityType: 'traditionalStrengthTraining',
		start: s.startedAt.toISOString(),
		end: s.endedAt.toISOString(),
		durationSec: Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000),
		totalEnergyBurnedKcal: s.estimatedKcal,
		metadata: {
			HKExternalUUID: `strengthmaxxing-${s.id}`,
			workoutName: s.name,
			totalVolumeKg: s.totalVolumeKg,
			sets: s.sets.length
		}
	};
}

// ---------- settings (single row) ----------
export type Units = 'lb' | 'kg';
export type AppSettings = {
	units: Units;
	voiceCount: boolean;
	restAlarmSnoozeSec: number;
	profile: Record<string, unknown> | null;
};

export function getSettings(): AppSettings {
	const row = db.select().from(settings).where(eq(settings.id, 1)).get();
	return {
		units: row?.units === 'kg' ? 'kg' : 'lb',
		voiceCount: row?.voiceCount ?? true,
		restAlarmSnoozeSec: row?.restAlarmSnoozeSec ?? 60,
		profile: row?.profile ?? null
	};
}

export function patchSettings(patch: Partial<AppSettings>) {
	const next = { ...getSettings(), ...patch };
	const row = { id: 1, ...next, updatedAt: new Date() };
	db.insert(settings).values(row).onConflictDoUpdate({ target: settings.id, set: row }).run();
	return next;
}

// ---------- rep-counter calibration ----------
export const listCalibration = () => db.select().from(calibration).all();

export function putCalibration(exerciseId: number, params: Record<string, unknown>, samples: number) {
	const row = { exerciseId, params, samples, updatedAt: new Date() };
	return db
		.insert(calibration)
		.values(row)
		.onConflictDoUpdate({ target: calibration.exerciseId, set: row })
		.returning()
		.get();
}

// ---------- raw motion traces ----------
export function addMotionTrace(input: {
	exerciseId: number;
	setClientId?: string | null;
	sampleHz: number;
	detectedReps: number;
	actualReps: number;
	params?: Record<string, unknown> | null;
	samples: unknown[];
}) {
	return db
		.insert(motionTraces)
		.values({ ...input, setClientId: input.setClientId ?? null, params: input.params ?? null, samples: JSON.stringify(input.samples) })
		.returning({ id: motionTraces.id })
		.get();
}

export const listMotionTraces = (exerciseId?: number) =>
	db
		.select({
			id: motionTraces.id,
			exerciseId: motionTraces.exerciseId,
			setClientId: motionTraces.setClientId,
			sampleHz: motionTraces.sampleHz,
			detectedReps: motionTraces.detectedReps,
			actualReps: motionTraces.actualReps,
			createdAt: motionTraces.createdAt
		})
		.from(motionTraces)
		.where(exerciseId ? eq(motionTraces.exerciseId, exerciseId) : undefined)
		.orderBy(desc(motionTraces.createdAt))
		.all();
