import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

type WorkoutExerciseBody = {
	exerciseId: number;
	orderIndex?: number;
	supersetGroup?: number | null;
	targetSets?: number;
	targetReps?: number;
	targetWeightKg?: number;
	restSec?: number;
	perSide?: boolean;
};

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// GET /api/workouts/:id → workout | 404
export const GET: RequestHandler = async ({ params }) => {
	const id = parseId(params.id);
	let w;
	try {
		w = await repo.getWorkout(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load workout');
	}
	if (!w) throw error(404, 'workout not found');
	return json(w);
};

// PATCH /api/workouts/:id body: any of {name,notes,archived,exercises}
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = parseId(params.id);
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	const patch: {
		name?: string;
		notes?: string | null;
		archived?: boolean;
		exercises?: WorkoutExerciseBody[];
	} = {};

	if (b.name !== undefined) {
		if (typeof b.name !== 'string' || b.name.trim() === '') throw error(400, 'name must be a non-empty string');
		patch.name = b.name;
	}
	if (b.notes !== undefined) {
		if (b.notes !== null && typeof b.notes !== 'string') throw error(400, 'notes must be a string or null');
		patch.notes = b.notes as string | null;
	}
	if (b.archived !== undefined) {
		if (typeof b.archived !== 'boolean') throw error(400, 'archived must be a boolean');
		patch.archived = b.archived;
	}
	if (b.exercises !== undefined) {
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
				restSec: numOrUndef(e.restSec, 'restSec'),
				perSide: e.perSide === undefined ? undefined : e.perSide === true
			});
		}
		patch.exercises = exercises;
	}

	// Ensure the workout exists before mutating.
	let existing;
	try {
		existing = await repo.getWorkout(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load workout');
	}
	if (!existing) throw error(404, 'workout not found');

	try {
		const updated = await repo.updateWorkout(id, patch);
		return json(updated);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to update workout');
	}
};

// DELETE /api/workouts/:id → soft-archive
export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseId(params.id);
	let existing;
	try {
		existing = await repo.getWorkout(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load workout');
	}
	if (!existing) throw error(404, 'workout not found');
	try {
		repo.deleteWorkout(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to archive workout');
	}
	return json({ ok: true });
};

function numOrUndef(v: unknown, field: string): number | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'number') throw error(400, `${field} must be a number`);
	return v;
}
