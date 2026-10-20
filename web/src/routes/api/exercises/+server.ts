import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/exercises → Exercise[]
export const GET: RequestHandler = () => {
	try {
		return json(repo.listExercises());
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to list exercises');
	}
};

const CATEGORIES = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell'];

// POST /api/exercises body {name, muscle, category, isBodyweight?, defaultRestSec?, met?} → 201
export const POST: RequestHandler = async ({ request }) => {
	let b: Record<string, unknown>;
	try {
		b = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const name = typeof b?.name === 'string' ? b.name.trim() : '';
	const muscle = typeof b?.muscle === 'string' ? b.muscle.trim().toLowerCase() : '';
	if (!name) throw error(400, 'name is required');
	if (!muscle) throw error(400, 'muscle is required');
	if (typeof b.category !== 'string' || !CATEGORIES.includes(b.category))
		throw error(400, `category must be one of ${CATEGORIES.join(', ')}`);
	for (const f of ['defaultRestSec', 'met'] as const)
		if (b[f] !== undefined && (typeof b[f] !== 'number' || (b[f] as number) <= 0))
			throw error(400, `${f} must be a positive number`);
	if (b.isBodyweight !== undefined && typeof b.isBodyweight !== 'boolean')
		throw error(400, 'isBodyweight must be a boolean');
	try {
		const ex = repo.createExercise({
			name,
			muscle,
			category: b.category,
			isBodyweight: b.isBodyweight as boolean | undefined,
			defaultRestSec: b.defaultRestSec as number | undefined,
			met: b.met as number | undefined
		});
		return json(ex, { status: 201 });
	} catch (e) {
		if (repo.isUniqueError(e)) throw error(409, 'an exercise with that name exists');
		throw error(500, e instanceof Error ? e.message : 'failed to create exercise');
	}
};
