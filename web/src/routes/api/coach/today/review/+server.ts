import { json, error } from '@sveltejs/kit';
import type { SessionPlan } from '$lib/server/today';
import { coachPlanDay } from '$lib/server/dayplan';
import type { RequestHandler } from './$types';

// POST /api/coach/today/review body {plan: SessionPlan} → today's workout planned by the coach
// (see $lib/server/dayplan), using the posted quick plan's check-in. 502 when the agent fails;
// the caller keeps the quick plan.
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	const plan = b?.plan as SessionPlan | undefined;
	if (!plan || !Array.isArray(plan.exercises)) throw error(400, 'plan.exercises[] required');
	try {
		return json(await coachPlanDay(plan));
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
};
