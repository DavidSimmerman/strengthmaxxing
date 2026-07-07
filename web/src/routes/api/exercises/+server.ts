import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/exercises → Exercise[]
export const GET: RequestHandler = () => {
	try {
		return json(repo.listExercises());
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to list exercises');
	}
};
