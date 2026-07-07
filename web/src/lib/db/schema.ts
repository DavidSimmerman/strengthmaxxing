import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql, relations } from 'drizzle-orm';

const now = sql`(unixepoch())`;

/** Exercise library. MET drives calorie estimation; muscle drives soreness/volume grouping. */
export const exercises = sqliteTable('exercises', {
	id: integer().primaryKey({ autoIncrement: true }),
	name: text().notNull().unique(),
	muscle: text().notNull(), // primary muscle group, e.g. "chest", "quads"
	category: text().notNull().default('barbell'), // barbell | dumbbell | machine | bodyweight | cable
	met: real().notNull().default(5.0), // metabolic equivalent for kcal estimation
	isBodyweight: integer({ mode: 'boolean' }).notNull().default(false),
	defaultRestSec: integer().notNull().default(120),
	createdAt: integer({ mode: 'timestamp' }).notNull().default(now)
});

/** A reusable workout template. */
export const workouts = sqliteTable('workouts', {
	id: integer().primaryKey({ autoIncrement: true }),
	name: text().notNull(),
	notes: text(),
	archived: integer({ mode: 'boolean' }).notNull().default(false),
	createdAt: integer({ mode: 'timestamp' }).notNull().default(now)
});

/**
 * An exercise slot inside a workout template with its targets.
 * supersetGroup: exercises sharing a non-null group number (within one workout) are performed
 * back-to-back as a superset. null = standalone.
 */
export const workoutExercises = sqliteTable('workout_exercises', {
	id: integer().primaryKey({ autoIncrement: true }),
	workoutId: integer()
		.notNull()
		.references(() => workouts.id, { onDelete: 'cascade' }),
	exerciseId: integer()
		.notNull()
		.references(() => exercises.id, { onDelete: 'cascade' }),
	orderIndex: integer().notNull().default(0),
	supersetGroup: integer(),
	targetSets: integer().notNull().default(3),
	targetReps: integer().notNull().default(8),
	targetWeightKg: real().notNull().default(0),
	restSec: integer().notNull().default(120)
});

/** A performed workout (one training session / log entry). */
export const sessions = sqliteTable('sessions', {
	id: integer().primaryKey({ autoIncrement: true }),
	workoutId: integer().references(() => workouts.id, { onDelete: 'set null' }), // null = ad-hoc
	name: text().notNull().default('Workout'),
	source: text().notNull().default('web'), // web | ios | watch
	startedAt: integer({ mode: 'timestamp' }).notNull().default(now),
	endedAt: integer({ mode: 'timestamp' }),
	notes: text(),
	bodyweightKg: real(), // snapshot for kcal/strength math
	readinessScore: integer(), // 0-100, from the coach/healthmaxxing at session start
	// cached rollups (recomputed on session end) so exports/reports stay cheap:
	totalVolumeKg: real().notNull().default(0),
	estimatedKcal: real().notNull().default(0),
	exportedAt: integer({ mode: 'timestamp' }) // when pushed to healthmaxxing
});

/** A single performed set. */
export const sessionSets = sqliteTable('session_sets', {
	id: integer().primaryKey({ autoIncrement: true }),
	sessionId: integer()
		.notNull()
		.references(() => sessions.id, { onDelete: 'cascade' }),
	exerciseId: integer()
		.notNull()
		.references(() => exercises.id, { onDelete: 'cascade' }),
	setIndex: integer().notNull().default(0),
	supersetGroup: integer(),
	reps: integer().notNull().default(0),
	weightKg: real().notNull().default(0),
	rpe: real(), // rate of perceived exertion 1-10 (optional)
	isWarmup: integer({ mode: 'boolean' }).notNull().default(false),
	restSecActual: integer(), // measured rest before the NEXT set
	startedAt: integer({ mode: 'timestamp' }),
	completedAt: integer({ mode: 'timestamp' }).notNull().default(now)
});

/**
 * Per-rep timing — the fatigue signal. offsetMs = ms from the set's first rep to this rep's
 * completion. Rising inter-rep gaps = the lifter slowing down = fatigue.
 * concentricMs (optional) = duration of the lifting phase if the watch measures it.
 */
export const repEvents = sqliteTable('rep_events', {
	id: integer().primaryKey({ autoIncrement: true }),
	sessionSetId: integer()
		.notNull()
		.references(() => sessionSets.id, { onDelete: 'cascade' }),
	repIndex: integer().notNull(),
	offsetMs: integer().notNull(),
	concentricMs: integer()
});

/**
 * Daily readiness cache. Populated from healthmaxxing (sleep, energy balance, soreness) so
 * reports and the coach can factor recovery. Keyed by ISO date (YYYY-MM-DD), one row per day.
 */
export const readiness = sqliteTable('readiness', {
	date: text().primaryKey(), // YYYY-MM-DD
	sleepHours: real(),
	kcalBalance: real(), // yesterday's intake - expenditure (negative = deficit)
	proteinG: real(),
	sorenessNote: text(),
	hrvMs: real(),
	restingHr: integer(),
	score: integer(), // 0-100 computed readiness
	updatedAt: integer({ mode: 'timestamp' }).notNull().default(now)
});

// ---- relations (for db.query.* nested reads) ----
export const workoutsRel = relations(workouts, ({ many }) => ({
	exercises: many(workoutExercises)
}));
export const workoutExercisesRel = relations(workoutExercises, ({ one }) => ({
	workout: one(workouts, { fields: [workoutExercises.workoutId], references: [workouts.id] }),
	exercise: one(exercises, { fields: [workoutExercises.exerciseId], references: [exercises.id] })
}));
export const sessionsRel = relations(sessions, ({ many, one }) => ({
	sets: many(sessionSets),
	workout: one(workouts, { fields: [sessions.workoutId], references: [workouts.id] })
}));
export const sessionSetsRel = relations(sessionSets, ({ one, many }) => ({
	session: one(sessions, { fields: [sessionSets.sessionId], references: [sessions.id] }),
	exercise: one(exercises, { fields: [sessionSets.exerciseId], references: [exercises.id] }),
	reps: many(repEvents)
}));
export const repEventsRel = relations(repEvents, ({ one }) => ({
	set: one(sessionSets, { fields: [repEvents.sessionSetId], references: [sessionSets.id] })
}));
