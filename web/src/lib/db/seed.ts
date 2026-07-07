import { db } from './index';
import { exercises } from './schema';
import { sql } from 'drizzle-orm';

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
	['Face Pull', 'shoulders', 'cable', 3.5, false, 60]
];

/** Idempotent — safe to run on every boot. Only inserts when the table is empty. */
export function seedExercises() {
	const [{ n }] = db.select({ n: sql<number>`count(*)` }).from(exercises).all();
	if (n > 0) return;
	db.insert(exercises)
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
		.run();
	console.log(`[seed] inserted ${LIB.length} exercises`);
}
