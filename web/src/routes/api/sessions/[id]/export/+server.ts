import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// GET /api/sessions/:id/export → single enriched sessionExport | 404
export const GET: RequestHandler = ({ params }) => {
	const id = parseId(params.id);
	let out;
	try {
		out = repo.sessionExport(id);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to export session');
	}
	if (!out) throw error(404, 'session not found');
	return json(out);
};
