import { db } from './index';
import { exercises } from './schema';

// A compact but useful starter library. MET ≈ metabolic cost for kcal estimation.
// [name, muscle, category, met, isBodyweight, defaultRestSec]
const LIB: [string, string, string, number, boolean, number][] = [
	['Back Squat', 'quads', 'barbell', 6.0, false, 180],
	['Front Squat', 'quads', 'barbell', 6.0, false, 180],
	['Deadlift', 'back', 'barbell', 6.0, false, 210],
	['Romanian Deadlift', 'hamstrings', 'barbell', 6.0, false, 150],
	['Bench Press', 'chest', 'barbell', 5.0, false, 150],
	['Incline Bench Press', 'chest', 'barbell', 5.0, false, 150],
	['Overhead Press', 'shoulders', 'barbell', 5.0, false, 150],
	['Barbell Row', 'back', 'barbell', 5.0, false, 120],
	['Pull-Up', 'back', 'bodyweight', 8.0, true, 120],
	['Chin-Up', 'back', 'bodyweight', 8.0, true, 120],
	['Dip', 'chest', 'bodyweight', 8.0, true, 120],
	['Push-Up', 'chest', 'bodyweight', 8.0, true, 60],
	['Dumbbell Bench Press', 'chest', 'dumbbell', 5.0, false, 120],
	['Dumbbell Shoulder Press', 'shoulders', 'dumbbell', 5.0, false, 120],
	['Dumbbell Row', 'back', 'dumbbell', 5.0, false, 90],
	['Lateral Raise', 'shoulders', 'dumbbell', 4.0, false, 60],
	['Bicep Curl', 'biceps', 'dumbbell', 3.5, false, 60],
	['Hammer Curl', 'biceps', 'dumbbell', 3.5, false, 60],
	['Tricep Pushdown', 'triceps', 'cable', 3.5, false, 60],
	['Cable Fly', 'chest', 'cable', 3.5, false, 75],
	['Lat Pulldown', 'back', 'cable', 4.0, false, 90],
	['Seated Cable Row', 'back', 'cable', 4.0, false, 90],
	['Leg Press', 'quads', 'machine', 5.0, false, 150],
	['Leg Extension', 'quads', 'machine', 4.0, false, 75],
	['Leg Curl', 'hamstrings', 'machine', 4.0, false, 75],
	['Calf Raise', 'calves', 'machine', 4.0, false, 60],
	['Hip Thrust', 'glutes', 'barbell', 5.0, false, 120],
	['Plank', 'core', 'bodyweight', 4.0, true, 45],
	['Hanging Leg Raise', 'core', 'bodyweight', 5.0, true, 60],
	['Face Pull', 'shoulders', 'cable', 3.5, false, 60],
	['Goblet Squat', 'quads', 'dumbbell', 5.0, false, 90],
	['Bulgarian Split Squat', 'quads', 'dumbbell', 5.0, false, 90],
	['Walking Lunge', 'quads', 'dumbbell', 5.0, false, 90],
	['Hack Squat', 'quads', 'machine', 5.0, false, 150],
	['Trap Bar Deadlift', 'back', 'barbell', 6.0, false, 180],
	['Sumo Deadlift', 'back', 'barbell', 6.0, false, 180],
	['Good Morning', 'hamstrings', 'barbell', 5.0, false, 120],
	['Dumbbell Romanian Deadlift', 'hamstrings', 'dumbbell', 5.0, false, 90],
	['Close-Grip Bench Press', 'triceps', 'barbell', 5.0, false, 120],
	['Incline Dumbbell Press', 'chest', 'dumbbell', 5.0, false, 120],
	['Dumbbell Fly', 'chest', 'dumbbell', 3.5, false, 60],
	['Machine Chest Press', 'chest', 'machine', 4.0, false, 90],
	['Pec Deck', 'chest', 'machine', 3.5, false, 60],
	['Arnold Press', 'shoulders', 'dumbbell', 5.0, false, 90],
	['Rear Delt Fly', 'shoulders', 'dumbbell', 3.5, false, 60],
	['Upright Row', 'shoulders', 'barbell', 4.0, false, 75],
	['Shrug', 'back', 'dumbbell', 3.5, false, 60],
	['T-Bar Row', 'back', 'barbell', 5.0, false, 120],
	['Chest-Supported Row', 'back', 'dumbbell', 4.5, false, 90],
	['Straight-Arm Pulldown', 'back', 'cable', 3.5, false, 60],
	['Barbell Curl', 'biceps', 'barbell', 3.5, false, 60],
	['Preacher Curl', 'biceps', 'machine', 3.5, false, 60],
	['Incline Dumbbell Curl', 'biceps', 'dumbbell', 3.5, false, 60],
	['Cable Curl', 'biceps', 'cable', 3.5, false, 60],
	['Skull Crusher', 'triceps', 'barbell', 3.5, false, 60],
	['Overhead Tricep Extension', 'triceps', 'dumbbell', 3.5, false, 60],
	['Seated Calf Raise', 'calves', 'machine', 4.0, false, 60],
	['Glute Bridge', 'glutes', 'bodyweight', 4.0, true, 60],
	['Cable Crunch', 'core', 'cable', 4.0, false, 60],
	['Ab Wheel Rollout', 'core', 'bodyweight', 5.0, true, 60],
	['Russian Twist', 'core', 'bodyweight', 4.0, true, 45],
	['Kettlebell Swing', 'glutes', 'kettlebell', 8.0, false, 90],
	['Farmer Carry', 'core', 'dumbbell', 6.0, false, 90],
	['Smith Machine Squat', 'quads', 'smith machine', 6.0, false, 150],
	['Smith Machine Bench Press', 'chest', 'smith machine', 5.0, false, 120],
	['Smith Machine Incline Press', 'chest', 'smith machine', 5.0, false, 120],
	['Smith Machine Shoulder Press', 'shoulders', 'smith machine', 5.0, false, 120],
	['Smith Machine Row', 'back', 'smith machine', 5.0, false, 90],
	['Smith Machine Romanian Deadlift', 'hamstrings', 'smith machine', 5.0, false, 120],
	['Smith Machine Hip Thrust', 'glutes', 'smith machine', 5.0, false, 90],
	['Smith Machine Split Squat', 'quads', 'smith machine', 5.0, false, 90],
	['Smith Machine Calf Raise', 'calves', 'smith machine', 4.0, false, 60],
	['Smith Machine Close-Grip Press', 'triceps', 'smith machine', 5.0, false, 90],
	['Cable Lateral Raise', 'shoulders', 'cable', 3.5, false, 60],
	['Cable Row', 'back', 'cable', 4.0, false, 90],
	['Cable Pull-Through', 'glutes', 'cable', 4.0, false, 75],
	['Cable Woodchop', 'core', 'cable', 4.0, false, 45],
	['Cable Overhead Tricep Extension', 'triceps', 'cable', 3.5, false, 60],
	['Cable Leg Curl', 'hamstrings', 'cable', 3.5, false, 60],
	['Cable Kickback', 'glutes', 'cable', 3.5, false, 60],
	['Bench Dip', 'triceps', 'bodyweight', 5.0, true, 60],
	['Dumbbell Pullover', 'back', 'dumbbell', 4.0, false, 75],
	['Dumbbell Step-Up', 'quads', 'dumbbell', 5.0, false, 75],
	['Box Jump', 'quads', 'bodyweight', 8.0, true, 90],
	['Single-Leg Romanian Deadlift', 'hamstrings', 'dumbbell', 5.0, false, 75],
	['Pallof Press', 'core', 'cable', 3.5, false, 45]
];

/** Idempotent — safe to run on every boot. Inserts any library exercise not yet present by name,
 * so exercises added to LIB later reach existing databases too. */
export function seedExercises() {
	const res = db
		.insert(exercises)
		.values(
			LIB.map(([name, muscle, category, met, isBodyweight, defaultRestSec]) => ({
				name,
				muscle,
				category,
				met,
				isBodyweight,
				defaultRestSec
			}))
		)
		.onConflictDoNothing({ target: exercises.name })
		.run();
	if (res.changes) console.log(`[seed] inserted ${res.changes} exercises`);
}
