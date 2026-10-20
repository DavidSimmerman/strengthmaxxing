import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/workouts → Workout[] with nested exercises (each .exercise joined)
export const GET: RequestHandler = async () => {
	try {
		return json(await repo.listWorkouts());
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to list workouts');
	}
};

type WorkoutExerciseBody = {
	exerciseId: number;
	orderIndex?: number;
	supersetGroup?: number | null;
	targetSets?: number;
	targetReps?: number;
	targetWeightKg?: number;
	restSec?: number;
};

// POST /api/workouts → created workout
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	if (typeof b.name !== 'string' || b.name.trim() === '') throw error(400, 'name is required');
	if (b.notes !== undefined && b.notes !== null && typeof b.notes !== 'string')
		throw error(400, 'notes must be a string');
	if (!Array.isArray(b.exercises)) throw error(400, 'exercises must be an array');

	const exercises: WorkoutExerciseBody[] = [];
	for (const raw of b.exercises) {
		if (typeof raw !== 'object' || raw === null) throw error(400, 'each exercise must be an object');
		const e = raw as Record<string, unknown>;
		if (typeof e.exerciseId !== 'number') throw error(400, 'exercise.exerciseId must be a number');
		exercises.push({
			exerciseId: e.exerciseId,
			orderIndex: numOrUndef(e.orderIndex, 'orderIndex'),
			supersetGroup: e.supersetGroup === null ? null : numOrUndef(e.supersetGroup, 'supersetGroup'),
			targetSets: numOrUndef(e.targetSets, 'targetSets'),
			targetReps: numOrUndef(e.targetReps, 'targetReps'),
			targetWeightKg: numOrUndef(e.targetWeightKg, 'targetWeightKg'),
			restSec: numOrUndef(e.restSec, 'restSec')
		});
	}

	try {
		const created = repo.createWorkout({
			name: b.name,
			notes: (b.notes as string | undefined) ?? null,
			exercises
		});
		return json(created, { status: 201 });
	} catch (e) {
		if (repo.isFkError(e)) throw error(400, 'exerciseId does not exist');
		throw error(500, e instanceof Error ? e.message : 'failed to create workout');
	}
};

function numOrUndef(v: unknown, field: string): number | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'number') throw error(400, `${field} must be a number`);
	return v;
}
