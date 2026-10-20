import { error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const h = repo.exerciseHistory(Number(params.id));
	if (!h) throw error(404, 'Exercise not found');
	// one point per session: that day's best e1RM
	const byDay = new Map<number, { date: Date; e1rm: number; top: { reps: number; weightKg: number } }>();
	for (const s of h.sets) {
		const cur = byDay.get(s.sessionId);
		if (!cur || s.e1rm > cur.e1rm) byDay.set(s.sessionId, { date: s.date, e1rm: s.e1rm, top: s });
	}
	return { ...h, sessions: [...byDay.entries()].map(([sessionId, v]) => ({ sessionId, ...v })) };
};
