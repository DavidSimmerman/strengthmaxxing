import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// PUT /api/calibration/:exerciseId body {params:object, samples:number} → row
export const PUT: RequestHandler = async ({ params, request }) => {
	const exerciseId = Number(params.exerciseId);
	if (!Number.isInteger(exerciseId) || exerciseId <= 0) throw error(400, 'invalid exerciseId');
	let b: Record<string, unknown>;
	try {
		b = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (typeof b?.params !== 'object' || b.params === null || Array.isArray(b.params))
		throw error(400, 'params must be an object');
	if (typeof b.samples !== 'number' || !Number.isInteger(b.samples) || b.samples < 0)
		throw error(400, 'samples must be a non-negative integer');
	try {
		return json(repo.putCalibration(exerciseId, b.params as Record<string, unknown>, b.samples));
	} catch (e) {
		if (repo.isFkError(e)) throw error(400, 'exerciseId does not exist');
		throw e;
	}
};
