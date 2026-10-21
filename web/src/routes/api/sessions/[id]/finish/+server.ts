import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// POST /api/sessions/:id/finish body {notes?, bodyweightKg?, activeKcal?, avgHr?, kcalSource?}
// → finalized session. activeKcal/kcalSource ('apple_watch' | 'heart_rate') replace the MET
// estimate; sending them again after finish updates just the calories.
export const POST: RequestHandler = async ({ params, request }) => {
	const id = parseId(params.id);

	let body: unknown = {};
	try {
		body = await request.json();
	} catch {
		// empty body is allowed
		body = {};
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	const patch: { notes?: string; bodyweightKg?: number; measured?: repo.MeasuredKcal } = {};
	if (b.activeKcal !== undefined && b.activeKcal !== null) {
		if (typeof b.activeKcal !== 'number' || !Number.isFinite(b.activeKcal) || b.activeKcal < 0 || b.activeKcal > 5000)
			throw error(400, 'activeKcal must be 0-5000');
		if (b.kcalSource !== 'apple_watch' && b.kcalSource !== 'heart_rate')
			throw error(400, 'kcalSource must be apple_watch or heart_rate');
		if (b.avgHr != null && (typeof b.avgHr !== 'number' || b.avgHr < 30 || b.avgHr > 250))
			throw error(400, 'avgHr must be 30-250');
		patch.measured = { activeKcal: b.activeKcal, kcalSource: b.kcalSource, avgHr: (b.avgHr as number | null) ?? null };
	}
	if (b.notes !== undefined) {
		if (typeof b.notes !== 'string') throw error(400, 'notes must be a string');
		patch.notes = b.notes;
	}
	if (b.bodyweightKg !== undefined && b.bodyweightKg !== null) {
		if (typeof b.bodyweightKg !== 'number' || b.bodyweightKg < 25 || b.bodyweightKg > 350)
			throw error(400, 'bodyweightKg must be 25-350');
		patch.bodyweightKg = b.bodyweightKg;
	}

	let finished;
	try {
		finished = repo.finishSession(id, patch);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to finish session');
	}
	if (!finished) throw error(404, 'session not found');
	return json(finished);
};
