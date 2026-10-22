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
	const chat = coach.getChat();
	// The plan under discussion is the last one proposed in chat, saved or not.
	const lastPlan = [...chat].reverse().find((m) => m.plan)?.plan ?? coach.getActiveProgram()?.plan ?? null;
	const conversation = chat.slice(-30).map((m) =>
		m.role === 'user'
			? { role: 'lifter', text: m.text }
			: {
					role: 'coach',
					text: m.text,
					...(m.plan ? { proposedPlan: `${m.plan.name}: ${m.plan.days.map((d) => d.name).join(' / ')}` } : {})
				}
	);
	const [user, reply] = coach.appendChat(
		{ role: 'user', text },
		{ role: 'coach', text: '', pending: true }
	);
	void answer(text, conversation, lastPlan, fetch)
		.then((r) => coach.patchChat(reply.id, { pending: false, ...r }))
		.catch((e) => fail(reply.id, e));
	return json({ messages: [user, reply] });
};

/** Ask the agent; remember stated preferences; check the plan and retry once if it breaks them. */
async function answer(
	text: string,
	conversation: object[],
	currentPlan: coach.CoachPlan | null,
	fetchFn: typeof fetch
) {
	const base = {
		units: repo.getSettings().units,
		request: text,
		conversation,
		history: coach.historySummary(),
		library: repo.listExercises().map((e) => `${e.name} [${e.category}]`),
		currentPlan: currentPlan ?? undefined
	};
	let feedback: string[] = [];
	for (let attempt = 0; ; attempt++) {
		const data = await coach.callAgent('/plan', { ...base, profile: coach.getProfile(), feedback }, fetchFn);
		if (data.profile && typeof data.profile === 'object') coach.saveProfile(cleanProfile(data.profile as Record<string, unknown>));
		const plan = coach.resolvePlan(data.plan);
		feedback = plan ? coach.planProblems(plan, coach.getProfile()) : [];
		if (feedback.length && attempt === 0) continue;
		const changed = plan && (!currentPlan || !coach.samePlan(plan, currentPlan));
		return {
			text: String(data.reply || data.rationale || 'Here you go.'),
			...(changed ? { plan: plan!, rationale: String(data.rationale ?? '') } : {})
		};
	}
}

/** Keep only well-formed profile fields from the model. */
function cleanProfile(p: Record<string, unknown>): coach.CoachProfile {
	const out: coach.CoachProfile = {};
	const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 500) : undefined);
	const int = (v: unknown, lo: number, hi: number) =>
		typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
	out.goal = str(p.goal);
	out.experience = str(p.experience);
	out.avoid = str(p.avoid);
	out.notes = str(p.notes);
	out.daysPerWeek = int(p.daysPerWeek, 1, 7);
	out.sessionMin = int(p.sessionMin, 15, 180);
	if (Array.isArray(p.equipment)) out.equipment = p.equipment.filter((e): e is string => typeof e === 'string').slice(0, 20);
	return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as coach.CoachProfile;
}

const fail = (id: string, e: unknown) =>
	coach.patchChat(id, {
		pending: false,
		error: true,
		text: `I couldn't reach the coach: ${e instanceof Error ? e.message : 'unknown error'}`
	});
