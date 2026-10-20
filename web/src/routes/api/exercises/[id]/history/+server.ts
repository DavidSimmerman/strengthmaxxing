import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/exercises/:id/history → {exercise, sets:[{date,sessionId,reps,weightKg,e1rm}], prs}
export const GET: RequestHandler = ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	const h = repo.exerciseHistory(id);
	if (!h) throw error(404, 'exercise not found');
	return json(h);
};
