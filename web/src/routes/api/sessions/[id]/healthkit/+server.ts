import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// GET /api/sessions/:id/healthkit → HKWorkout payload (404 if null, e.g. unfinished session)
export const GET: RequestHandler = ({ params }) => {
	const id = parseId(params.id);
	let payload;
	try {
		payload = repo.healthkitPayload(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to build healthkit payload');
	}
	if (!payload) throw error(404, 'session not found or not finished');
	return json(payload);
};
