import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

// GET /api/coach/chat → {messages}. Poll while any message has pending:true.
export const GET: RequestHandler = () => json({ messages: coach.getChat() });

// DELETE /api/coach/chat → clears the conversation (profile and program are kept)
export const DELETE: RequestHandler = () => {
	coach.clearChat();
	return new Response(null, { status: 204 });
};

/**
 * POST /api/coach/chat
 *   {text}             → the coach answers; may carry a new or revised program
 *   {action:'weights'} → suggested weights for the next workout
 * Returns at once with {messages: [user, coach(pending)]}; the coach message is filled in
 * the background (replies take ~20-90 s, past Cloudflare's 100 s request limit).
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	const b = await request.json().catch(() => null);
	if (typeof b !== 'object' || b === null) throw error(400, 'body must be an object');

	if (b.action === 'weights') {
		const id = coach.nextWorkoutId();
		if (id == null) throw error(400, 'Build a program first');
		const w = repo.getWorkout(id)!;
		const [user, reply] = coach.appendChat(
			{ role: 'user', text: `What should I lift on ${w.name} today?` },
			{ role: 'coach', text: '', pending: true }
		);
		void coach
			.progressFor(id, fetch)
			.then((r) =>
				coach.patchChat(reply.id, {
					pending: false,
					text: r!.summary,
					progress: { workoutId: id, workoutName: w.name, readiness: r!.readiness, adjustments: r!.adjustments }
				})
			)
			.catch((e) => fail(reply.id, e));
		return json({ messages: [user, reply] });
	}

	const text = typeof b.text === 'string' ? b.text.trim() : '';
	if (!text) throw error(400, 'text required');
	const history = coach.getChat().slice(-8).map((m) => `${m.role}: ${m.text}`);
	const [user, reply] = coach.appendChat(
		{ role: 'user', text },
		{ role: 'coach', text: '', pending: true }
	);
	const active = coach.getActiveProgram();
	void coach
		.callAgent(
			'/plan',
			{
				profile: coach.getProfile(),
				units: repo.getSettings().units,
				request: text,
				conversation: history,
				history: coach.historySummary(),
				library: repo.listExercises().map((e) => e.name),
				currentPlan: active?.plan
			},
			fetch
		)
		.then((data) => {
			const plan = coach.resolvePlan(data.plan);
			const changed = plan && (!active || !coach.samePlan(plan, active.plan));
			coach.patchChat(reply.id, {
				pending: false,
				text: String(data.reply || data.rationale || 'Here you go.'),
				...(changed ? { plan: plan!, rationale: String(data.rationale ?? '') } : {})
			});
		})
		.catch((e) => fail(reply.id, e));
	return json({ messages: [user, reply] });
};

const fail = (id: string, e: unknown) =>
	coach.patchChat(id, {
		pending: false,
		error: true,
		text: `I couldn't reach the coach: ${e instanceof Error ? e.message : 'unknown error'}`
	});
