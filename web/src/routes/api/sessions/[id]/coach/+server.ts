import { json, error } from '@sveltejs/kit';
import { liveChat } from '$lib/server/live';
import type { RequestHandler } from './$types';

// POST /api/sessions/:id/coach body {message} → {reply, applied[]}: talk to the coach mid-workout.
// The coach may swap exercises, change weight/reps/sets, add a dislike or note pain (validated).
export const POST: RequestHandler = async ({ params, request }) => {
	const b = await request.json().catch(() => null);
	const message = typeof b?.message === 'string' ? b.message.trim() : '';
	if (!message) throw error(400, 'message required');
	let r;
	try {
		r = await liveChat(Number(params.id), message);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
	if (!r) throw error(404, 'open session not found');
	return json(r);
};
