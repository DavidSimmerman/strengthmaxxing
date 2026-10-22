import { json, error } from '@sveltejs/kit';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

// POST /api/coach/workout-edit body {messageId} → saves the coach's proposed change to that workout
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	if (typeof b?.messageId !== 'string') throw error(400, 'messageId required');
	const m = coach.getChat().find((x) => x.id === b.messageId);
	if (!m?.workoutEdit) throw error(404, 'no workout change in that message');
	if (!m.workoutEdit.after.some((x) => x.exerciseId)) throw error(400, 'change has no valid exercises');
	coach.applyWorkoutEdit(m.workoutEdit);
	coach.patchChat(m.id, { editSaved: true });
	return json({ ok: true });
};
