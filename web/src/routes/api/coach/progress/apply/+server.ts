import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// POST /api/coach/progress/apply body {workoutId, adjustments:[{name,suggestedWeightKg,suggestedReps}]}
// → writes the accepted suggestions into the workout template's targets.
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	if (typeof b?.workoutId !== 'number' || !Array.isArray(b.adjustments)) throw error(400, 'workoutId and adjustments[] required');
	const w = repo.getWorkout(b.workoutId);
	if (!w) throw error(404, 'workout not found');
	const byName = new Map<string, { suggestedWeightKg?: number; suggestedReps?: number }>(
		b.adjustments.map((a: { name: string }) => [a.name, a])
	);
	let changed = 0;
	const exercises = w.exercises.map((we) => {
		const a = byName.get(we.exercise.name);
		const weight = Number(a?.suggestedWeightKg);
		const reps = Number(a?.suggestedReps);
		if (a) changed++;
		return {
			exerciseId: we.exerciseId,
			orderIndex: we.orderIndex,
			supersetGroup: we.supersetGroup,
			targetSets: we.targetSets,
			targetReps: a && Number.isInteger(reps) && reps > 0 ? reps : we.targetReps,
			targetWeightKg: a && Number.isFinite(weight) && weight >= 0 ? weight : we.targetWeightKg,
			restSec: we.restSec
		};
	});
	repo.updateWorkout(w.id, { exercises });
	return json({ ok: true, changed });
};
