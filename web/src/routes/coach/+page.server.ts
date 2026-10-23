import * as repo from '$lib/server/repo';
import * as coach from '$lib/server/coach';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = () => {
	const program = coach.getActiveProgram();
	const next = coach.nextWorkoutId();
	return {
		messages: coach.getChat(),
		profile: coach.getProfile(),
		library: repo.listExercises().map((e) => e.name),
		program: program ? { name: program.name, weeks: program.weeks, week: coach.programWeek(program) } : null,
		nextWorkout: next ? (repo.getWorkout(next)?.name ?? null) : null
	};
};
