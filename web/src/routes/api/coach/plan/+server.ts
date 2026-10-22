import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

/**
 * POST /api/coach/plan body {request?, profile?, revise?:boolean}
 * Builds a multi-week program from the saved profile + free-text request + training history.
 * `revise: true` edits the active program instead of starting fresh. A `profile` in the body
 * is saved first. → {plan (exercises carry exerciseId), rationale, reply}
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	let b: Record<string, unknown>;
	try {
		b = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (b.request !== undefined && typeof b.request !== 'string') throw error(400, 'request must be a string');
	if (b.profile !== undefined) {
		if (typeof b.profile !== 'object' || b.profile === null) throw error(400, 'profile must be an object');
		coach.saveProfile(b.profile as coach.CoachProfile);
	}
	const profile = coach.getProfile();
	const active = b.revise ? coach.getActiveProgram() : null;
	if (b.revise && !active) throw error(400, 'no active program to revise');

	let data;
	try {
		data = await coach.callAgent(
			'/plan',
			{
				profile,
				units: repo.getSettings().units,
				request: (b.request as string | undefined) ?? '',
				history: coach.historySummary(),
				library: repo.listExercises().map((e) => `${e.name} [${e.category}]`),
				currentPlan: active?.plan
			},
			fetch
		);
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
	const plan = coach.resolvePlan(data.plan);
	if (!plan) throw error(502, 'coach returned no plan');
	return json({ plan, rationale: data.rationale ?? '', reply: data.reply ?? '' });
};
