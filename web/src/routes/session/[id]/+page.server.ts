import { error, redirect, fail } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	const session = await repo.getSession(id);
	if (!session) throw error(404, 'Session not found');

	// if the session is finished, this screen is just done — bounce to history detail
	if (session.endedAt) throw redirect(303, `/history/${id}`);

	// planned exercises: from the template if any, else the exercises already logged
	const template = session.workoutId ? await repo.getWorkout(session.workoutId) : undefined;

	type Planned = {
		exerciseId: number;
		name: string;
		muscle: string;
		category: string;
		targetSets: number;
		targetReps: number;
		targetWeightKg: number;
		restSec: number;
		supersetGroup: number | null;
		orderIndex: number;
	};

	let planned: Planned[] = [];
	if (template) {
		planned = template.exercises.map((we) => ({
			exerciseId: we.exerciseId,
			name: we.exercise.name,
			muscle: we.exercise.muscle,
			category: we.exercise.category,
			targetSets: we.targetSets,
			targetReps: we.targetReps,
			targetWeightKg: we.targetWeightKg,
			restSec: we.restSec,
			supersetGroup: we.supersetGroup,
			orderIndex: we.orderIndex
		}));
	} else {
		// ad-hoc: derive slots from whatever's been logged
		const seen = new Map<number, Planned>();
		for (const set of session.sets) {
			if (!seen.has(set.exerciseId)) {
				seen.set(set.exerciseId, {
					exerciseId: set.exerciseId,
					name: set.exercise.name,
					muscle: set.exercise.muscle,
					category: set.exercise.category,
					targetSets: 3,
					targetReps: 8,
					targetWeightKg: set.weightKg,
					restSec: set.exercise.defaultRestSec,
					supersetGroup: set.supersetGroup,
					orderIndex: seen.size
				});
			}
		}
		planned = [...seen.values()];
	}

	// logged sets grouped by exercise
	const setsByExercise = new Map<number, typeof session.sets>();
	for (const s of session.sets) {
		const arr = setsByExercise.get(s.exerciseId) ?? [];
		arr.push(s);
		setsByExercise.set(s.exerciseId, arr);
	}

	const exercises = planned.map((p) => {
		const done = (setsByExercise.get(p.exerciseId) ?? []).sort((a, b) => a.setIndex - b.setIndex);
		return {
			...p,
			sets: done.map((s) => ({
				id: s.id,
				setIndex: s.setIndex,
				reps: s.reps,
				weightKg: s.weightKg,
				rpe: s.rpe,
				isWarmup: s.isWarmup,
				volume: s.reps * s.weightKg
			})),
			lastWeight: done.length ? done[done.length - 1].weightKg : p.targetWeightKg,
			lastReps: done.length ? done[done.length - 1].reps : p.targetReps
		};
	});

	// exercise library for adding on the fly (ad-hoc)
	const library = repo.listExercises().map((e) => ({
		id: e.id,
		name: e.name,
		muscle: e.muscle,
		category: e.category,
		defaultRestSec: e.defaultRestSec
	}));

	const totalVolume = session.sets
		.filter((s) => !s.isWarmup)
		.reduce((t, s) => t + s.reps * s.weightKg, 0);
	const totalSets = session.sets.filter((s) => !s.isWarmup).length;

	return {
		session: {
			id: session.id,
			name: session.name,
			startedAt: session.startedAt,
			readinessScore: session.readinessScore
		},
		exercises,
		library,
		totalVolume,
		totalSets
	};
};

export const actions: Actions = {
	addSet: async ({ params, request }) => {
		const id = Number(params.id);
		const fd = await request.formData();
		const exerciseId = Number(fd.get('exerciseId'));
		const reps = Number(fd.get('reps'));
		const weightKg = Number(fd.get('weightKg'));
		const setIndex = Number(fd.get('setIndex') ?? 0);
		const supersetGroup = fd.get('supersetGroup') ? Number(fd.get('supersetGroup')) : null;
		const isWarmup = fd.get('isWarmup') === 'true';
		if (!exerciseId || Number.isNaN(reps) || Number.isNaN(weightKg))
			return fail(400, { error: 'reps and weight required' });
		repo.addSet(id, { exerciseId, setIndex, supersetGroup, reps, weightKg, isWarmup });
		return { ok: true, loggedExercise: exerciseId };
	},

	addExercise: async ({ params, request }) => {
		// no-op storage: adding an exercise just needs a first set; we surface it client-side.
		// But to support ad-hoc slot creation we log a placeholder? No — instead return the picked id.
		const fd = await request.formData();
		void params;
		const exerciseId = Number(fd.get('exerciseId'));
		if (!exerciseId) return fail(400, { error: 'pick an exercise' });
		return { ok: true, addedExercise: exerciseId };
	},

	finish: async ({ params, request }) => {
		const id = Number(params.id);
		const fd = await request.formData();
		const notes = (fd.get('notes') as string) || undefined;
		const bw = fd.get('bodyweightKg') ? Number(fd.get('bodyweightKg')) : undefined;
		repo.finishSession(id, { notes, bodyweightKg: bw });
		throw redirect(303, `/history/${id}`);
	}
};
