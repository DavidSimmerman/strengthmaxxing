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
	isCustom: integer({ mode: 'boolean' }).notNull().default(false), // user-added, not from the seed
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
	restSec: integer().notNull().default(120), // rest after the set (after BOTH sides when perSide)
	perSide: integer({ mode: 'boolean' }).notNull().default(false) // one arm / leg at a time, left then right
});

/** A performed workout (one training session / log entry). */
export const sessions = sqliteTable('sessions', {
	id: integer().primaryKey({ autoIncrement: true }),
	clientId: text().unique(), // UUID from an offline client (watch) — makes POST /sessions idempotent
	workoutId: integer().references(() => workouts.id, { onDelete: 'set null' }), // null = ad-hoc
	name: text().notNull().default('Workout'),
	source: text().notNull().default('web'), // web | ios | watch
	startedAt: integer({ mode: 'timestamp' }).notNull().default(now),
	endedAt: integer({ mode: 'timestamp' }),
	notes: text(),
	bodyweightKg: real(), // snapshot for kcal/strength math
	readinessScore: integer(), // 0-100, from the coach/healthmaxxing at session start
	// exercises added mid-session that aren't in the template (ids), so they persist before a set
	extraExerciseIds: text({ mode: 'json' }).$type<number[]>(),
	// template exercises skipped for this session only (the template itself is unchanged)
	removedExerciseIds: text({ mode: 'json' }).$type<number[]>(),
	// start-of-workout check-in: energy 1-5, soreness per body area 0 fresh / 1 a bit / 2 very
	checkin: text({ mode: 'json' }).$type<{ energy: number | null; soreness: Record<string, number> }>(),
	// coach's per-exercise suggestions for this session (filled in the background)
	suggestions: text({ mode: 'json' }).$type<Record<string, unknown>>(),
	// Generated session (dynamic coach): exercises with sets / reps / weight / rest / reasons.
	// Null for template and ad-hoc sessions. Shape: SessionPlan in $lib/coach/build.
	plan: text({ mode: 'json' }).$type<Record<string, unknown>>(),
	// Mid-workout chat with the coach: [{role:'user'|'coach', text, at, applied?: string[]}].
	chat: text({ mode: 'json' }).$type<{ role: 'user' | 'coach'; text: string; at: string; applied?: string[] }[]>(),
	// cached rollups (recomputed on session end) so exports/reports stay cheap:
	totalVolumeKg: real().notNull().default(0),
	estimatedKcal: real().notNull().default(0), // active kcal (matches Apple's "Active Calories")
	// where estimatedKcal came from: apple_watch (the watch's live workout), heart_rate (phone,
	// from heart-rate samples), estimate (MET formula). Non-estimate values are never recomputed.
	kcalSource: text().notNull().default('estimate'),
	avgHr: real(), // bpm over the session, when a heart-rate source exists
	exportedAt: integer({ mode: 'timestamp' }) // when pushed to healthmaxxing
});

/** A single performed set. */
export const sessionSets = sqliteTable('session_sets', {
	id: integer().primaryKey({ autoIncrement: true }),
	clientId: text().unique(), // UUID from the watch outbox — makes POST /sets idempotent
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
	side: text(), // 'L' | 'R' for one-side-at-a-time exercises (a pair shares setIndex); null = both
	restSecActual: integer(), // rest before THIS set: its start − the previous set's finish (phone: estimated start)
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

/**
 * App-wide settings — a single row (id = 1). Shared by dashboard, phone and watch.
 * `profile` is the coach profile (goals, schedule, equipment) as JSON.
 */
export const settings = sqliteTable('settings', {
	id: integer().primaryKey(),
	units: text().notNull().default('lb'), // lb | kg — display only; storage is always kg
	voiceCount: integer({ mode: 'boolean' }).notNull().default(true),
	restAlarmSnoozeSec: integer().notNull().default(60),
	profile: text({ mode: 'json' }).$type<Record<string, unknown>>(),
	updatedAt: integer({ mode: 'timestamp' }).notNull().default(now)
});

/**
 * Per-exercise rep-counter calibration learned on the watch from user corrections.
 * `params` is opaque to the server — the watch owns the algorithm.
 */
export const calibration = sqliteTable('calibration', {
	exerciseId: integer()
		.primaryKey()
		.references(() => exercises.id, { onDelete: 'cascade' }),
	params: text({ mode: 'json' }).notNull().$type<Record<string, unknown>>(),
	samples: integer().notNull().default(0),
	updatedAt: integer({ mode: 'timestamp' }).notNull().default(now)
});

/** Raw wrist-motion recordings of sets, kept so the rep counter can be tuned offline. */
export const motionTraces = sqliteTable('motion_traces', {
	id: integer().primaryKey({ autoIncrement: true }),
	exerciseId: integer()
		.notNull()
		.references(() => exercises.id, { onDelete: 'cascade' }),
	setClientId: text(),
	sampleHz: real().notNull(),
	detectedReps: integer().notNull(),
	actualReps: integer().notNull(),
	params: text({ mode: 'json' }).$type<Record<string, unknown>>(),
	samples: text().notNull(), // JSON array of [tMs,ax,ay,az,gx,gy,gz,rx,ry,rz]
	createdAt: integer({ mode: 'timestamp' }).notNull().default(now)
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
	// named repEvents (not "reps") so it doesn't shadow the reps integer column
	repEvents: many(repEvents)
}));
export const repEventsRel = relations(repEvents, ({ one }) => ({
	set: one(sessionSets, { fields: [repEvents.sessionSetId], references: [sessionSets.id] })
}));

/**
 * Short coach notes shown on the home screen between workouts (protein, training fasted,
 * sleep, praise…). At most one new note per day; `day` is the local date it was written for.
 */
export const coachNotes = sqliteTable('coach_notes', {
	id: integer().primaryKey({ autoIncrement: true }),
	day: text().notNull(), // YYYY-MM-DD
	kind: text().notNull(), // protein | fasted | deficit | sleep | praise
	title: text().notNull(),
	body: text().notNull(),
	facts: text({ mode: 'json' }).$type<Record<string, unknown>>(),
	createdAt: integer({ mode: 'timestamp' }).notNull().default(now),
	dismissedAt: integer({ mode: 'timestamp' })
});
