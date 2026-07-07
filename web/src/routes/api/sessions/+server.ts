import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/sessions?limit=30 → session summaries (newest first)
export const GET: RequestHandler = ({ url }) => {
	const limitParam = url.searchParams.get('limit');
	let limit = 30;
	if (limitParam !== null) {
		const n = Number(limitParam);
		if (!Number.isInteger(n) || n <= 0) throw error(400, 'limit must be a positive integer');
		limit = n;
	}
	try {
		return json(repo.listSessions(limit));
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to list sessions');
	}
};

// POST /api/sessions body {workoutId?,name?,source?,bodyweightKg?,readinessScore?} → started session
export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		// Allow empty body → ad-hoc session with defaults.
		body = {};
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	const input: {
		workoutId?: number | null;
		name?: string;
		source?: string;
		bodyweightKg?: number | null;
		readinessScore?: number | null;
	} = {};

	if (b.workoutId !== undefined && b.workoutId !== null) {
		if (typeof b.workoutId !== 'number') throw error(400, 'workoutId must be a number');
		input.workoutId = b.workoutId;
	}
	if (b.name !== undefined) {
		if (typeof b.name !== 'string') throw error(400, 'name must be a string');
		input.name = b.name;
	}
	if (b.source !== undefined) {
		if (typeof b.source !== 'string') throw error(400, 'source must be a string');
		input.source = b.source;
	}
	if (b.bodyweightKg !== undefined && b.bodyweightKg !== null) {
		if (typeof b.bodyweightKg !== 'number') throw error(400, 'bodyweightKg must be a number');
		input.bodyweightKg = b.bodyweightKg;
	}
	if (b.readinessScore !== undefined && b.readinessScore !== null) {
		if (typeof b.readinessScore !== 'number') throw error(400, 'readinessScore must be a number');
		input.readinessScore = b.readinessScore;
	}

	try {
		const s = repo.startSession(input);
		return json(s, { status: 201 });
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to start session');
	}
};
