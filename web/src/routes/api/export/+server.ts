import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/export?since=<ISO> → {app,exportedAt,sessions:[sessionExport]}
export const GET: RequestHandler = ({ url }) => {
	const since = url.searchParams.get('since');
	let sinceMs: number | undefined;
	if (since !== null) {
		const ms = Date.parse(since);
		if (Number.isNaN(ms)) throw error(400, 'since must be an ISO date string');
		sinceMs = ms;
	}
	try {
		return json(repo.fullExport(sinceMs));
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to export');
	}
};
