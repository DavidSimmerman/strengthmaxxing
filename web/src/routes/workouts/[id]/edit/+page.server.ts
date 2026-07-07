import { error, redirect, fail } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { WorkoutExerciseInput } from '$lib/server/repo';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	const w = await repo.getWorkout(id);
	if (!w) throw error(404, 'Workout not found');
	return {
		workout: {
			id: w.id,
			name: w.name,
			notes: w.notes ?? '',
			exercises: w.exercises.map((e) => ({
				exerciseId: e.exerciseId,
				name: e.exercise.name,
				muscle: e.exercise.muscle,
				targetSets: e.targetSets,
				targetReps: e.targetReps,
				targetWeightKg: e.targetWeightKg,
				restSec: e.restSec,
				supersetGroup: e.supersetGroup
			}))
		},
		library: repo.listExercises().map((e) => ({
			id: e.id,
			name: e.name,
			muscle: e.muscle,
			category: e.category,
			defaultRestSec: e.defaultRestSec
		}))
	};
};

export const actions: Actions = {
	default: async ({ params, request }) => {
		const id = Number(params.id);
		const fd = await request.formData();
		const name = ((fd.get('name') as string) || '').trim();
		const notes = ((fd.get('notes') as string) || '').trim() || null;
		let exercises: WorkoutExerciseInput[] = [];
		try {
			exercises = JSON.parse((fd.get('exercises') as string) || '[]');
		} catch {
			return fail(400, { error: 'bad exercise data' });
		}
		if (!name) return fail(400, { error: 'name required' });
		if (!exercises.length) return fail(400, { error: 'add at least one exercise' });
		repo.updateWorkout(id, { name, notes, exercises });
		throw redirect(303, `/workouts`);
	}
};
