import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const AGENT_URL = env.AGENT_URL || 'http://localhost:8787';

// POST /api/coach/plan → forwards to agent POST /plan. On agent error return 502.
export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	if (typeof b.goal !== 'string' || b.goal.trim() === '') throw error(400, 'goal is required');
	if (typeof b.daysPerWeek !== 'number') throw error(400, 'daysPerWeek is required and must be a number');
	if (typeof b.experience !== 'string' || b.experience.trim() === '')
		throw error(400, 'experience is required');
	if (b.equipment !== undefined && !Array.isArray(b.equipment) && typeof b.equipment !== 'string')
		throw error(400, 'equipment must be an array or string');
	if (b.constraints !== undefined && typeof b.constraints !== 'string' && !Array.isArray(b.constraints))
		throw error(400, 'constraints must be a string or array');

	let res: Response;
	try {
		res = await fetch(`${AGENT_URL}/plan`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(b)
		});
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
	if (!res.ok) throw error(502, `coach agent error (${res.status})`);

	let data: unknown;
	try {
		data = await res.json();
	} catch {
		throw error(502, 'coach agent returned invalid JSON');
	}
	return json(data);
};
