import { json, error } from '@sveltejs/kit';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

// POST /api/coach/program body {plan} → saves each day as a workout, makes it the active program
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	const plan = coach.resolvePlan(b?.plan);
	if (!plan || !plan.days.length) throw error(400, 'plan with days[] required');
	return json(coach.saveProgram(plan), { status: 201 });
};
