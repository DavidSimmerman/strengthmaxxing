import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

function parseId(param: string): number {
	const id = Number(param);
	if (!Number.isInteger(id) || id <= 0) throw error(400, 'invalid id');
	return id;
}

// POST /api/sessions/:id/sets → created set (what the watch posts per completed set)
export const POST: RequestHandler = async ({ params, request }) => {
	const sessionId = parseId(params.id);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	if (typeof b.exerciseId !== 'number') throw error(400, 'exerciseId is required and must be a number');
	if (typeof b.reps !== 'number' || !Number.isInteger(b.reps) || b.reps <= 0)
		throw error(400, 'reps must be a positive integer');
	if (typeof b.weightKg !== 'number' || !Number.isFinite(b.weightKg) || b.weightKg < 0)
		throw error(400, 'weightKg must be a non-negative number');

	if (b.clientId !== undefined && b.clientId !== null && (typeof b.clientId !== 'string' || !b.clientId))
		throw error(400, 'clientId must be a string');
	const clientId = (b.clientId as string | undefined) ?? null;
	if (clientId) {
		// Watch outbox retries: same clientId → the set we already stored, no duplicate.
		const existing = repo.findSetByClientId(clientId);
		if (existing) return json(existing, { status: 200 });
	}

	const input: repo.SetInput = {
		clientId,
		exerciseId: b.exerciseId,
		reps: b.reps,
		weightKg: b.weightKg,
		setIndex: numOrUndef(b.setIndex, 'setIndex'),
		supersetGroup: b.supersetGroup === null ? null : numOrUndef(b.supersetGroup, 'supersetGroup'),
		rpe: b.rpe === null ? null : numOrUndef(b.rpe, 'rpe'),
		isWarmup: boolOrUndef(b.isWarmup, 'isWarmup'),
		restSecActual: b.restSecActual === null ? null : numOrUndef(b.restSecActual, 'restSecActual'),
		startedAt: b.startedAt === null ? null : numOrUndef(b.startedAt, 'startedAt'),
		completedAt: b.completedAt === null ? null : numOrUndef(b.completedAt, 'completedAt')
	};

	if (b.repEvents !== undefined && b.repEvents !== null) {
		if (!Array.isArray(b.repEvents)) throw error(400, 'repEvents must be an array');
		const events: { repIndex: number; offsetMs: number; concentricMs?: number | null }[] = [];
		for (const raw of b.repEvents) {
			if (typeof raw !== 'object' || raw === null) throw error(400, 'each repEvent must be an object');
			const r = raw as Record<string, unknown>;
			if (typeof r.repIndex !== 'number') throw error(400, 'repEvent.repIndex must be a number');
			if (typeof r.offsetMs !== 'number') throw error(400, 'repEvent.offsetMs must be a number');
			events.push({
				repIndex: r.repIndex,
				offsetMs: r.offsetMs,
				concentricMs: r.concentricMs === null ? null : numOrUndef(r.concentricMs, 'concentricMs')
			});
		}
		input.repEvents = events;
	}

	// Ensure the session exists so we don't insert an orphan set.
	let session;
	try {
		session = await repo.getSession(sessionId);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load session');
	}
	if (!session) throw error(404, 'session not found');
	// Sets landing after finish are accepted (late watch sync); repo recomputes rollups.

	try {
		const set = repo.addSet(sessionId, input);
		return json(set, { status: 201 });
	} catch (e) {
		if (repo.isFkError(e)) throw error(400, 'exerciseId does not exist');
		throw error(500, e instanceof Error ? e.message : 'failed to add set');
	}
};

function numOrUndef(v: unknown, field: string): number | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'number') throw error(400, `${field} must be a number`);
	return v;
}
function boolOrUndef(v: unknown, field: string): boolean | undefined {
	if (v === undefined) return undefined;
	if (typeof v !== 'boolean') throw error(400, `${field} must be a boolean`);
	return v;
}
