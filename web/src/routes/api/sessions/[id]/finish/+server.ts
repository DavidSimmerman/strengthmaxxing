import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// POST /api/sessions/:id/finish body {notes?,bodyweightKg?} → finalized session
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

	const patch: { notes?: string; bodyweightKg?: number } = {};
	if (b.notes !== undefined) {
		if (typeof b.notes !== 'string') throw error(400, 'notes must be a string');
		patch.notes = b.notes;
	}
	if (b.bodyweightKg !== undefined && b.bodyweightKg !== null) {
		if (typeof b.bodyweightKg !== 'number') throw error(400, 'bodyweightKg must be a number');
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
