/**
 * The one place that touches the DB for mutations + derived reads.
 * Both the JSON API (routes/api) and the dashboard (+page.server actions) call these,
 * so business rules (rollups, export shape, fatigue math) live in exactly one spot.
 */
import { and, desc, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import {
	exercises,
	workouts,
	workoutExercises,
	sessions,
	sessionSets,
	repEvents,
	readiness
} from '$lib/db/schema';
import { e1rm, tonnage, repFatigue, estimateKcal, readinessScore } from '$lib/metrics';

// ---------- exercises ----------
export const listExercises = () => db.select().from(exercises).orderBy(exercises.muscle, exercises.name).all();

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
		const [w] = tx
			.insert(workouts)
			.values({ name: input.name, notes: input.notes ?? null })
			.returning();
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

function insertWorkoutExercises(tx: typeof db, workoutId: number, list: WorkoutExerciseInput[]) {
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
	db.query.workouts.findMany({
		where: eq(workouts.archived, false),
		orderBy: [desc(workouts.createdAt)],
		with: { exercises: { with: { exercise: true }, orderBy: [workoutExercises.orderIndex] } }
	});

export const getWorkout = (id: number) =>
	db.query.workouts.findFirst({
		where: eq(workouts.id, id),
		with: { exercises: { with: { exercise: true }, orderBy: [workoutExercises.orderIndex] } }
	});

export const deleteWorkout = (id: number) =>
	db.update(workouts).set({ archived: true }).where(eq(workouts.id, id)).run();

// ---------- sessions ----------
export function startSession(input: {
	workoutId?: number | null;
	name?: string;
	source?: string;
	bodyweightKg?: number | null;
	readinessScore?: number | null;
}) {
	const [s] = db
		.insert(sessions)
		.values({
			workoutId: input.workoutId ?? null,
			name: input.name ?? 'Workout',
			source: input.source ?? 'web',
			bodyweightKg: input.bodyweightKg ?? null,
			readinessScore: input.readinessScore ?? null
		})
		.returning();
	return s;
}

export type SetInput = {
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
	return db.transaction((tx) => {
		const [set] = tx
			.insert(sessionSets)
			.values({
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
			.returning();
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
}

/** Finalize a session: stamp endedAt and cache tonnage + kcal rollups. */
export function finishSession(id: number, patch?: { notes?: string; bodyweightKg?: number }) {
	const s = db.select().from(sessions).where(eq(sessions.id, id)).get();
	if (!s) return null;
	const sets = db.select().from(sessionSets).where(eq(sessionSets.sessionId, id)).all();
	const working = sets.filter((x) => !x.isWarmup);
	const totalVolumeKg = tonnage(working);

	const bw = patch?.bodyweightKg ?? s.bodyweightKg ?? 80;
	const endedAt = new Date();
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

	const [updated] = db
		.update(sessions)
		.set({
			endedAt,
			totalVolumeKg,
			estimatedKcal,
			bodyweightKg: bw,
			notes: patch?.notes ?? s.notes
		})
		.where(eq(sessions.id, id))
		.returning();
	return updated;
}

export const listSessions = (limit = 30) =>
	db.select().from(sessions).orderBy(desc(sessions.startedAt)).limit(limit).all();

export const getSession = (id: number) =>
	db.query.sessions.findFirst({
		where: eq(sessions.id, id),
		with: { sets: { with: { exercise: true, reps: true } }, workout: true }
	});

export const deleteSession = (id: number) => db.delete(sessions).where(eq(sessions.id, id)).run();

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
		const offsets = [...set.reps].sort((a, b) => a.repIndex - b.repIndex).map((r) => r.offsetMs);
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
