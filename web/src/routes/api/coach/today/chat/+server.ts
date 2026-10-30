import { json, error } from '@sveltejs/kit';
import { previewChat } from '$lib/server/live';
import type { SessionPlan } from '$lib/server/today';
import type { RequestHandler } from './$types';

// POST /api/coach/today/chat body {plan, message, chat?} → {plan, reply, applied[], chat}: talk to
// the coach about today's workout before starting it (swap, remove for today, weight, sets…).
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	const plan = b?.plan as SessionPlan | undefined;
	const message = typeof b?.message === 'string' ? b.message.trim() : '';
	if (!plan || !Array.isArray(plan.exercises)) throw error(400, 'plan.exercises[] required');
	if (!message) throw error(400, 'message required');
	const chat = Array.isArray(b?.chat) ? b.chat.filter((m: { role?: string; text?: unknown }) => (m?.role === 'user' || m?.role === 'coach') && typeof m.text === 'string') : [];
	try {
		return json(await previewChat(plan, message, chat));
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
};
