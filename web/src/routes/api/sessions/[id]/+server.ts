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

// PATCH /api/sessions/:id body {startedAt?, endedAt?} (epoch ms) → corrected session
export const PATCH: RequestHandler = async ({ params, request }) => {
	const id = parseId(params.id);
	const b = await request.json().catch(() => null);
	if (typeof b !== 'object' || b === null) throw error(400, 'body must be an object');
	const t: { startedAt?: Date; endedAt?: Date } = {};
	for (const k of ['startedAt', 'endedAt'] as const) {
		if (b[k] === undefined) continue;
		if (typeof b[k] !== 'number' || !Number.isFinite(b[k])) throw error(400, `${k} must be epoch ms`);
		t[k] = new Date(b[k]);
	}
	if (!t.startedAt && !t.endedAt) throw error(400, 'nothing to update');
	let s;
	try {
		s = repo.updateSessionTimes(id, t);
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'bad times');
	}
	if (!s) throw error(404, 'session not found');
	return json(s);
};
