import { fail } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const workouts = await repo.listWorkouts();
	return {
		workouts: workouts.map((w) => ({
			id: w.id,
			name: w.name,
			notes: w.notes,
			exercises: w.exercises.map((e) => ({
				name: e.exercise.name,
				muscle: e.exercise.muscle,
				targetSets: e.targetSets,
				targetReps: e.targetReps,
				supersetGroup: e.supersetGroup
			}))
		}))
	};
};

export const actions: Actions = {
	delete: async ({ request }) => {
		const fd = await request.formData();
		const id = Number(fd.get('id'));
		if (!id) return fail(400, { error: 'missing id' });
		repo.deleteWorkout(id);
		return { ok: true };
	}
};
