import { json, error } from '@sveltejs/kit';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

// POST /api/coach/program body {plan, messageId?} → saves each day as a workout, makes it the active program
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	const plan = coach.resolvePlan(b?.plan);
	if (!plan || !plan.days.length) throw error(400, 'plan with days[] required');
	const saved = coach.saveProgram(plan);
	if (typeof b.messageId === 'string') coach.patchChat(b.messageId, { saved: true });
	return json(saved, { status: 201 });
};
