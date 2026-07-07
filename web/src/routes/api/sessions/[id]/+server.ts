import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// GET /api/sessions/:id → session with nested sets (each .exercise, .reps)
export const GET: RequestHandler = async ({ params }) => {
	const id = parseId(params.id);
	let s;
	try {
		s = await repo.getSession(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load session');
	}
	if (!s) throw error(404, 'session not found');
	return json(s);
};

// DELETE /api/sessions/:id
export const DELETE: RequestHandler = async ({ params }) => {
	const id = parseId(params.id);
	let s;
	try {
		s = await repo.getSession(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load session');
	}
	if (!s) throw error(404, 'session not found');
	try {
		repo.deleteSession(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to delete session');
	}
	return json({ ok: true });
};
