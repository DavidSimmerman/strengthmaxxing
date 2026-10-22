import { error, fail, redirect } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import * as coach from '$lib/server/coach';
import { AREAS, estimateSoreness } from '$lib/server/soreness';
import { isoDay } from '$lib/ui';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const w = repo.getWorkout(Number(params.workoutId));
	if (!w) throw error(404, 'Workout not found');
	return { workout: { id: w.id, name: w.name }, areas: AREAS, estimate: estimateSoreness() };
};

export const actions: Actions = {
	// Start the session with (or without) a check-in; the coach's weights fill in afterwards.
	default: async ({ params, request }) => {
		const w = repo.getWorkout(Number(params.workoutId));
		if (!w) return fail(404, { error: 'Workout not found' });
		const fd = await request.formData();
		const skip = fd.get('skip') === '1';
		const energy = Number(fd.get('energy'));
		const soreness: Record<string, number> = {};
		for (const a of AREAS) {
			const v = Number(fd.get(`sore_${a}`));
			if (v === 0 || v === 1 || v === 2) soreness[a] = v;
		}
		const s = repo.startSession({
			workoutId: w.id,
			name: w.name,
			source: 'web',
			readinessScore: repo.getReadiness(isoDay())?.score ?? null,
			checkin: skip ? null : { energy: energy >= 1 && energy <= 5 ? energy : null, soreness }
		});
		void coach.suggestForSession(s.id);
		throw redirect(303, `/session/${s.id}`);
	}
};
