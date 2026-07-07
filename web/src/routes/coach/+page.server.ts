import * as repo from '$lib/server/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const workouts = await repo.listWorkouts();
	return {
		workouts: workouts.map((w) => ({
			id: w.id,
			name: w.name,
			exerciseCount: w.exercises.length
		}))
	};
};
