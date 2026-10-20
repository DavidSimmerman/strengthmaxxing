import * as repo from '$lib/server/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const best = repo.bestE1rmByExercise();
	return {
		exercises: repo.listExercises().map((e) => ({ ...e, bestE1rm: best.get(e.id) ?? null }))
	};
};
