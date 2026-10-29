/**
 * What each exercise trains, for the dynamic coach. Pure data, no I/O.
 *
 * Credits: 1 for the muscle the exercise is for, 0.5 for a real helper, 0.25 for a minor one
 * (fractional set counting — Pelland et al. 2025 found half-credit for indirect work fit best).
 * `stretch` marks exercises that load the muscle at long length (Maeo 2021/2023, Pedrosa 2022):
 * a bit more growth, a bit more soreness. `legCost` scales how sore an exercise leaves the legs
 * (lunges and RDLs are eccentric-heavy; step-ups and swings barely are) — David runs, so leg
 * work is chosen to build strength without wrecking the next run.
 */

export const MUSCLES = [
	'chest',
	'frontDelts',
	'sideDelts',
	'rearDelts',
	'lats',
	'upperBack',
	'biceps',
	'triceps',
	'abs',
	'obliques',
	'quads',
	'hamstrings',
	'glutes',
	'calves'
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MUSCLE_LABEL: Record<Muscle, string> = {
	chest: 'Chest',
	frontDelts: 'Front delts',
	sideDelts: 'Side delts',
	rearDelts: 'Rear delts',
	lats: 'Lats',
	upperBack: 'Upper back',
	biceps: 'Biceps',
	triceps: 'Triceps',
	abs: 'Abs',
	obliques: 'Obliques',
	quads: 'Quads',
	hamstrings: 'Hamstrings',
	glutes: 'Glutes',
	calves: 'Calves'
};

export const LEG_MUSCLES: readonly Muscle[] = ['quads', 'hamstrings', 'glutes', 'calves'];

export type Pattern =
	| 'hpush'
	| 'vpush'
	| 'hpull'
	| 'vpull'
	| 'squat'
	| 'hinge'
	| 'lunge'
	| 'power'
	| 'isolation'
	| 'core';

export type ExerciseProfile = {
	credits: Partial<Record<Muscle, number>>;
	pattern: Pattern;
	compound: boolean;
	stretch?: boolean;
	legCost?: number; // soreness multiplier for leg muscles, default 1
	repsOverride?: [number, number];
	noLoad?: boolean; // bodyweight / plyometric: progress reps, not weight
};

const P = (
	credits: ExerciseProfile['credits'],
	pattern: Pattern,
	extra: Partial<Omit<ExerciseProfile, 'credits' | 'pattern'>> = {}
): ExerciseProfile => ({ credits, pattern, compound: pattern !== 'isolation' && pattern !== 'core', ...extra });

const PRESS = { chest: 1, frontDelts: 0.5, triceps: 0.5 };
const OHP = { frontDelts: 1, sideDelts: 0.5, triceps: 0.5 };
const ROW = { upperBack: 1, lats: 0.5, biceps: 0.5, rearDelts: 0.25 };

export const PROFILES: Record<string, ExerciseProfile> = {
	'Back Squat': P({ quads: 1, glutes: 0.5 }, 'squat', { legCost: 1.2 }),
	'Front Squat': P({ quads: 1, glutes: 0.25, abs: 0.25 }, 'squat', { legCost: 1.2 }),
	Deadlift: P({ glutes: 0.75, hamstrings: 0.75, upperBack: 0.5, quads: 0.25 }, 'hinge', { legCost: 1.2 }),
	'Romanian Deadlift': P({ hamstrings: 1, glutes: 0.5 }, 'hinge', { stretch: true, legCost: 1.4 }),
	'Bench Press': P(PRESS, 'hpush'),
	'Incline Bench Press': P(PRESS, 'hpush'),
	'Overhead Press': P(OHP, 'vpush'),
	'Barbell Row': P(ROW, 'hpull'),
	'Pull-Up': P({ lats: 1, biceps: 0.5, upperBack: 0.5 }, 'vpull', { noLoad: true }),
	'Chin-Up': P({ lats: 1, biceps: 0.75, upperBack: 0.25 }, 'vpull', { noLoad: true }),
	Dip: P({ chest: 1, triceps: 0.75, frontDelts: 0.5 }, 'hpush', { stretch: true, noLoad: true }),
	'Push-Up': P({ ...PRESS, abs: 0.25 }, 'hpush', { noLoad: true, repsOverride: [10, 25] }),
	'Dumbbell Bench Press': P(PRESS, 'hpush', { stretch: true }),
	'Dumbbell Shoulder Press': P(OHP, 'vpush'),
	'Dumbbell Row': P({ lats: 1, upperBack: 0.5, biceps: 0.5, rearDelts: 0.25 }, 'hpull'),
	'Lateral Raise': P({ sideDelts: 1 }, 'isolation'),
	'Bicep Curl': P({ biceps: 1 }, 'isolation'),
	'Hammer Curl': P({ biceps: 1 }, 'isolation'),
	'Tricep Pushdown': P({ triceps: 1 }, 'isolation'),
	'Cable Fly': P({ chest: 1 }, 'isolation', { stretch: true }),
	'Lat Pulldown': P({ lats: 1, biceps: 0.5, upperBack: 0.25 }, 'vpull'),
	'Seated Cable Row': P(ROW, 'hpull'),
	'Leg Press': P({ quads: 1, glutes: 0.5 }, 'squat', { legCost: 1.1 }),
	'Leg Extension': P({ quads: 1 }, 'isolation'),
	'Leg Curl': P({ hamstrings: 1 }, 'isolation'),
	'Calf Raise': P({ calves: 1 }, 'isolation', { stretch: true }),
	'Hip Thrust': P({ glutes: 1, hamstrings: 0.25 }, 'hinge', { legCost: 0.8 }),
	Plank: P({ abs: 0.5, obliques: 0.25 }, 'core', { noLoad: true, repsOverride: [30, 60] }),
	'Hanging Leg Raise': P({ abs: 1 }, 'core', { noLoad: true, repsOverride: [8, 15] }),
	'Face Pull': P({ rearDelts: 1, upperBack: 0.5 }, 'isolation'),
	'Goblet Squat': P({ quads: 1, glutes: 0.5, abs: 0.25 }, 'squat'),
	'Bulgarian Split Squat': P({ quads: 1, glutes: 0.75 }, 'lunge', { stretch: true, legCost: 1.5 }),
	'Walking Lunge': P({ quads: 1, glutes: 0.75 }, 'lunge', { legCost: 1.5 }),
	'Hack Squat': P({ quads: 1, glutes: 0.25 }, 'squat', { legCost: 1.2 }),
	'Trap Bar Deadlift': P({ glutes: 0.75, quads: 0.5, hamstrings: 0.5, upperBack: 0.25 }, 'hinge', { legCost: 1.1 }),
	'Sumo Deadlift': P({ glutes: 1, quads: 0.5, hamstrings: 0.5, upperBack: 0.5 }, 'hinge', { legCost: 1.2 }),
	'Good Morning': P({ hamstrings: 1, glutes: 0.5 }, 'hinge', { stretch: true, legCost: 1.4 }),
	'Dumbbell Romanian Deadlift': P({ hamstrings: 1, glutes: 0.5 }, 'hinge', { stretch: true, legCost: 1.4 }),
	'Close-Grip Bench Press': P({ triceps: 1, chest: 0.5, frontDelts: 0.25 }, 'hpush'),
	'Incline Dumbbell Press': P(PRESS, 'hpush', { stretch: true }),
	'Dumbbell Fly': P({ chest: 1 }, 'isolation', { stretch: true }),
	'Machine Chest Press': P(PRESS, 'hpush'),
	'Pec Deck': P({ chest: 1 }, 'isolation'),
	'Arnold Press': P(OHP, 'vpush'),
	'Rear Delt Fly': P({ rearDelts: 1, upperBack: 0.25 }, 'isolation'),
	'Upright Row': P({ sideDelts: 1, upperBack: 0.5, biceps: 0.25 }, 'vpush'),
	Shrug: P({ upperBack: 1 }, 'isolation'),
	'T-Bar Row': P(ROW, 'hpull'),
	'Chest-Supported Row': P({ ...ROW, rearDelts: 0.5 }, 'hpull'),
	'Straight-Arm Pulldown': P({ lats: 1 }, 'isolation', { stretch: true }),
	'Barbell Curl': P({ biceps: 1 }, 'isolation'),
	'Preacher Curl': P({ biceps: 1 }, 'isolation', { stretch: true }),
	'Incline Dumbbell Curl': P({ biceps: 1 }, 'isolation', { stretch: true }),
	'Cable Curl': P({ biceps: 1 }, 'isolation'),
	'Skull Crusher': P({ triceps: 1 }, 'isolation', { stretch: true }),
	'Overhead Tricep Extension': P({ triceps: 1 }, 'isolation', { stretch: true }),
	'Seated Calf Raise': P({ calves: 1 }, 'isolation'),
	'Glute Bridge': P({ glutes: 1 }, 'isolation', { noLoad: true, legCost: 0.7, repsOverride: [12, 25] }),
	'Cable Crunch': P({ abs: 1 }, 'core', { stretch: true }),
	'Ab Wheel Rollout': P({ abs: 1, obliques: 0.25 }, 'core', { stretch: true, noLoad: true, repsOverride: [6, 15] }),
	'Russian Twist': P({ obliques: 1, abs: 0.5 }, 'core', { noLoad: true, repsOverride: [12, 24] }),
	'Kettlebell Swing': P({ glutes: 1, hamstrings: 0.5 }, 'power', { legCost: 0.8 }),
	'Farmer Carry': P({ obliques: 0.5, abs: 0.5, upperBack: 0.5 }, 'core', { repsOverride: [30, 60] }),
	'Smith Machine Squat': P({ quads: 1, glutes: 0.5 }, 'squat', { legCost: 1.2 }),
	'Smith Machine Bench Press': P(PRESS, 'hpush'),
	'Smith Machine Incline Press': P(PRESS, 'hpush'),
	'Smith Machine Shoulder Press': P(OHP, 'vpush'),
	'Smith Machine Row': P(ROW, 'hpull'),
	'Smith Machine Romanian Deadlift': P({ hamstrings: 1, glutes: 0.5 }, 'hinge', { stretch: true, legCost: 1.4 }),
	'Smith Machine Hip Thrust': P({ glutes: 1, hamstrings: 0.25 }, 'hinge', { legCost: 0.8 }),
	'Smith Machine Split Squat': P({ quads: 1, glutes: 0.75 }, 'lunge', { stretch: true, legCost: 1.5 }),
	'Smith Machine Calf Raise': P({ calves: 1 }, 'isolation', { stretch: true }),
	'Smith Machine Close-Grip Press': P({ triceps: 1, chest: 0.5, frontDelts: 0.25 }, 'hpush'),
	'Cable Lateral Raise': P({ sideDelts: 1 }, 'isolation', { stretch: true }),
	'Cable Row': P(ROW, 'hpull'),
	'Cable Pull-Through': P({ glutes: 1, hamstrings: 0.5 }, 'hinge', { legCost: 0.8 }),
	'Cable Woodchop': P({ obliques: 1, abs: 0.5 }, 'core'),
	'Cable Overhead Tricep Extension': P({ triceps: 1 }, 'isolation', { stretch: true }),
	'Cable Leg Curl': P({ hamstrings: 1 }, 'isolation'),
	'Cable Kickback': P({ glutes: 1 }, 'isolation', { legCost: 0.8 }),
	'Bench Dip': P({ triceps: 1, chest: 0.25, frontDelts: 0.25 }, 'hpush', { noLoad: true, repsOverride: [10, 20] }),
	'Dumbbell Pullover': P({ lats: 1, chest: 0.5 }, 'isolation', { stretch: true }),
	'Dumbbell Step-Up': P({ quads: 1, glutes: 0.75 }, 'lunge', { legCost: 0.8 }),
	// Added for an athletic, run-friendly leg menu and an anti-rotation core option.
	'Box Jump': P({ quads: 0.5, glutes: 0.5, calves: 0.25 }, 'power', { noLoad: true, legCost: 0.5, repsOverride: [3, 5] }),
	'Single-Leg Romanian Deadlift': P({ hamstrings: 1, glutes: 0.75 }, 'hinge', { stretch: true, legCost: 1.1 }),
	'Pallof Press': P({ obliques: 1, abs: 0.5 }, 'core')
};

/** A custom exercise with no profile: credit its one listed muscle. */
const LEGACY: Record<string, Muscle> = {
	chest: 'chest',
	shoulders: 'frontDelts',
	back: 'upperBack',
	biceps: 'biceps',
	triceps: 'triceps',
	quads: 'quads',
	hamstrings: 'hamstrings',
	glutes: 'glutes',
	calves: 'calves',
	core: 'abs'
};

export function profileFor(name: string, muscle = ''): ExerciseProfile {
	return PROFILES[name] ?? P({ [LEGACY[muscle.toLowerCase()] ?? 'abs']: 1 }, 'isolation');
}

/** The muscle an exercise is mainly for (its highest credit). */
export function primaryMuscle(p: ExerciseProfile): Muscle {
	return (Object.entries(p.credits) as [Muscle, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
}
