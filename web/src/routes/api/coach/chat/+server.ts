import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

// GET /api/coach/chat → {messages}
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
 * Stores the user turn and the coach turn; returns {messages: [user, coach]}.
 */
export const POST: RequestHandler = async ({ request, fetch }) => {
	const b = await request.json().catch(() => null);
	if (typeof b !== 'object' || b === null) throw error(400, 'body must be an object');

	if (b.action === 'weights') {
		const id = coach.nextWorkoutId();
		if (id == null) throw error(400, 'Build a program first');
		const w = repo.getWorkout(id)!;
		const [user] = coach.appendChat({ role: 'user', text: `What should I lift on ${w.name} today?` });
		try {
			const r = (await coach.progressFor(id, fetch))!;
			const [reply] = coach.appendChat({
				role: 'coach',
				text: r.summary,
				progress: { workoutId: id, workoutName: w.name, readiness: r.readiness, adjustments: r.adjustments }
			});
			return json({ messages: [user, reply] });
		} catch (e) {
			const [reply] = coach.appendChat({ role: 'coach', text: `I couldn't reach the coach: ${msg(e)}`, error: true });
			return json({ messages: [user, reply] });
		}
	}

	const text = typeof b.text === 'string' ? b.text.trim() : '';
	if (!text) throw error(400, 'text required');
	const history = coach.getChat().slice(-8).map((m) => `${m.role}: ${m.text}`);
	const [user] = coach.appendChat({ role: 'user', text });
	const active = coach.getActiveProgram();
	try {
		const data = await coach.callAgent(
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
		);
		const plan = coach.resolvePlan(data.plan);
		const changed = plan && (!active || !coach.samePlan(plan, active.plan));
		const [reply] = coach.appendChat({
			role: 'coach',
			text: String(data.reply || data.rationale || 'Here you go.'),
			...(changed ? { plan: plan!, rationale: String(data.rationale ?? '') } : {})
		});
		return json({ messages: [user, reply] });
	} catch (e) {
		const [reply] = coach.appendChat({ role: 'coach', text: `I couldn't reach the coach: ${msg(e)}`, error: true });
		return json({ messages: [user, reply] });
	}
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');
