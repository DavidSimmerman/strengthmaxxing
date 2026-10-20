import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// PATCH /api/sessions/:id/sets/:setId body any of {reps, weightKg, rpe, isWarmup} → set
export const PATCH: RequestHandler = async ({ params, request }) => {
	const sessionId = parseId(params.id);
	const setId = parseId(params.setId);
	let b: Record<string, unknown>;
	try {
		b = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (typeof b !== 'object' || b === null) throw error(400, 'body must be an object');

	const patch: { reps?: number; weightKg?: number; rpe?: number | null; isWarmup?: boolean } = {};
	if (b.reps !== undefined) {
		if (typeof b.reps !== 'number' || !Number.isInteger(b.reps) || b.reps <= 0)
			throw error(400, 'reps must be a positive integer');
		patch.reps = b.reps;
	}
	if (b.weightKg !== undefined) {
		if (typeof b.weightKg !== 'number' || !Number.isFinite(b.weightKg) || b.weightKg < 0)
			throw error(400, 'weightKg must be a non-negative number');
		patch.weightKg = b.weightKg;
	}
	if (b.rpe !== undefined) {
		if (b.rpe !== null && (typeof b.rpe !== 'number' || b.rpe < 1 || b.rpe > 10))
			throw error(400, 'rpe must be 1-10 or null');
		patch.rpe = b.rpe as number | null;
	}
	if (b.isWarmup !== undefined) {
		if (typeof b.isWarmup !== 'boolean') throw error(400, 'isWarmup must be a boolean');
		patch.isWarmup = b.isWarmup;
	}
	if (!Object.keys(patch).length) throw error(400, 'nothing to update');

	const row = repo.updateSet(sessionId, setId, patch);
	if (!row) throw error(404, 'set not found');
	return json(row);
};

// DELETE /api/sessions/:id/sets/:setId → 204
export const DELETE: RequestHandler = ({ params }) => {
	const ok = repo.deleteSet(parseId(params.id), parseId(params.setId));
	if (!ok) throw error(404, 'set not found');
	return new Response(null, { status: 204 });
};
