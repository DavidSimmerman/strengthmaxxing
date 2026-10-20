import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/motion-traces?exerciseId= → metadata only (samples are large)
export const GET: RequestHandler = ({ url }) => {
	const q = url.searchParams.get('exerciseId');
	const exerciseId = q ? Number(q) : undefined;
	if (q && (!Number.isInteger(exerciseId) || exerciseId! <= 0)) throw error(400, 'invalid exerciseId');
	return json(repo.listMotionTraces(exerciseId));
};

// POST /api/motion-traces — a raw recording of one set, for offline tuning of the rep counter.
export const POST: RequestHandler = async ({ request }) => {
	let b: Record<string, unknown>;
	try {
		b = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0;
	if (!int(b?.exerciseId) || (b.exerciseId as number) === 0) throw error(400, 'exerciseId required');
	if (typeof b.sampleHz !== 'number' || b.sampleHz <= 0) throw error(400, 'sampleHz must be > 0');
	if (!int(b.detectedReps) || !int(b.actualReps)) throw error(400, 'detectedReps/actualReps required');
	if (!Array.isArray(b.samples) || !b.samples.length) throw error(400, 'samples must be a non-empty array');
	if (b.setClientId != null && typeof b.setClientId !== 'string') throw error(400, 'setClientId must be a string');
	if (b.params != null && (typeof b.params !== 'object' || Array.isArray(b.params)))
		throw error(400, 'params must be an object');
	try {
		const row = repo.addMotionTrace({
			exerciseId: b.exerciseId as number,
			setClientId: (b.setClientId as string | null) ?? null,
			sampleHz: b.sampleHz,
			detectedReps: b.detectedReps as number,
			actualReps: b.actualReps as number,
			params: (b.params as Record<string, unknown> | null) ?? null,
			samples: b.samples
		});
		return json(row, { status: 201 });
	} catch (e) {
		if (repo.isFkError(e)) throw error(400, 'exerciseId does not exist');
		throw e;
	}
};
