import { fail, redirect } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import { checkinTiles, planSuggestions, planToday, sorenessFromTiles, toSessionPlan, TILES, type SessionPlan } from '$lib/server/today';
import { isoDay } from '$lib/ui';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	tiles: checkinTiles(),
	open: repo.openSessions()
});

const MINUTES = [30, 45, 60, 75, 120];

function readCheckIn(fd: FormData) {
	const e = Number(fd.get('energy'));
	const m = Number(fd.get('minutes'));
	const byTile: Record<string, number> = {};
	for (const t of TILES) byTile[t.key] = Number(fd.get(`sore_${t.key}`)) || 0;
	return {
		energy: e >= 1 && e <= 5 ? e : null,
		minutes: MINUTES.includes(m) ? m : 45,
		soreness: sorenessFromTiles(byTile),
		byTile
	};
}

export const actions: Actions = {
	discardOpen: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		const s = repo.getSession(id);
		if (s && !s.endedAt) repo.deleteSession(id);
		return { ok: true };
	},
	// Engine only: instant. The page then asks Claude to review it (see /api/coach/today/review).
	build: async ({ request }) => {
		const c = readCheckIn(await request.formData());
		const checkIn = { energy: c.energy, minutes: c.minutes, soreness: c.soreness };
		return { plan: toSessionPlan(planToday(checkIn), checkIn) };
	},
	start: async ({ request }) => {
		const fd = await request.formData();
		let plan: SessionPlan;
		try {
			plan = JSON.parse(String(fd.get('plan')));
		} catch {
			return fail(400, { error: 'Bad plan' });
		}
		const lib = new Set(repo.listExercises().map((e) => e.id));
		if (!Array.isArray(plan?.exercises) || !plan.exercises.length || plan.exercises.some((x) => !lib.has(x.exerciseId)))
			return fail(400, { error: 'Bad plan' });
		const s = repo.startSession({
			name: plan.title || "Today's workout",
			source: 'web',
			readinessScore: repo.getReadiness(isoDay())?.score ?? null,
			checkin: { energy: plan.checkIn.energy, soreness: plan.checkIn.soreness as Record<string, number> },
			plan: plan as unknown as Record<string, unknown>
		});
		repo.setSessionSuggestions(s.id, {
			status: 'ready',
			at: new Date().toISOString(),
			summary: plan.summary ?? undefined,
			items: planSuggestions(plan)
		});
		throw redirect(303, `/session/${s.id}`);
	}
};
