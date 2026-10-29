import { json, error } from '@sveltejs/kit';
import { reviewPlan, type SessionPlan } from '$lib/server/today';
import type { RequestHandler } from './$types';

// POST /api/coach/today/review body {plan: SessionPlan} → the plan after Claude's review
// (exercise swaps within the same muscle, reasons, summary). 502 when the agent fails; the
// caller keeps the engine's plan.
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	const plan = b?.plan as SessionPlan | undefined;
	if (!plan || !Array.isArray(plan.exercises)) throw error(400, 'plan.exercises[] required');
	try {
		return json(await reviewPlan(plan));
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
};
