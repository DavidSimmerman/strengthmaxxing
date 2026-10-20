import { json, error } from '@sveltejs/kit';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

// POST /api/coach/progress body {workoutId,date?} → assembles context, forwards to agent /progress
export const POST: RequestHandler = async ({ request, fetch }) => {
	const b = await request.json().catch(() => null);
	if (typeof b !== 'object' || b === null) throw error(400, 'body must be an object');
	if (typeof b.workoutId !== 'number') throw error(400, 'workoutId is required and must be a number');
	if (b.date !== undefined && typeof b.date !== 'string') throw error(400, 'date must be a string');
	let r;
	try {
		r = await coach.progressFor(b.workoutId, fetch, b.date);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
	if (!r) throw error(404, 'workout not found');
	const { adjustments, summary } = r;
	return json({ adjustments, summary });
};
