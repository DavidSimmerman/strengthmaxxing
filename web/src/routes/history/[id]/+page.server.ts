import { error, redirect, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as repo from '$lib/server/repo';
import { db } from '$lib/db';
import { sessionSets } from '$lib/db/schema';
import { e1rm, repFatigue } from '$lib/metrics';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	const s = await repo.getSession(id);
	if (!s) throw error(404, 'Session not found');

	// numeric rep counts straight from the column (the relational query shadows `reps`
	// with the rep-events relation, so read it directly).
	const repCounts = new Map(
		db
			.select({ id: sessionSets.id, reps: sessionSets.reps })
			.from(sessionSets)
			.where(eq(sessionSets.sessionId, id))
			.all()
			.map((r) => [r.id, r.reps])
	);

	type OutSet = {
		id: number;
		setIndex: number;
		reps: number;
		weightKg: number;
		rpe: number | null;
		isWarmup: boolean;
		e1rmKg: number;
		fatigue: { decayPct: number; grinders: number; avgRepMs: number };
		repTimeline: number[];
	};
	const byExercise: {
		exerciseId: number;
		name: string;
		muscle: string;
		category: string;
		supersetGroup: number | null;
		bestE1rm: number;
		sets: OutSet[];
	}[] = [];
	const volumeByMuscle: Record<string, number> = {};

	for (const set of s.sets) {
		const reps = repCounts.get(set.id) ?? 0;
		const offsets = [...set.repEvents].sort((a, b) => a.repIndex - b.repIndex).map((r) => r.offsetMs);
		const out: OutSet = {
			id: set.id,
			setIndex: set.setIndex,
			reps,
			weightKg: set.weightKg,
			rpe: set.rpe,
			isWarmup: set.isWarmup,
			e1rmKg: +e1rm(set.weightKg, reps).toFixed(1),
			fatigue: repFatigue(offsets),
			repTimeline: offsets
		};
		let g = byExercise.find((x) => x.name === set.exercise.name);
		if (!g) {
			g = {
				exerciseId: set.exerciseId,
				name: set.exercise.name,
				muscle: set.exercise.muscle,
				category: set.exercise.category,
				supersetGroup: set.supersetGroup,
				bestE1rm: 0,
				sets: []
			};
			byExercise.push(g);
		}
		g.sets.push(out);
		if (!set.isWarmup) {
			g.bestE1rm = Math.max(g.bestE1rm, out.e1rmKg);
			volumeByMuscle[set.exercise.muscle] =
				(volumeByMuscle[set.exercise.muscle] ?? 0) + reps * set.weightKg;
		}
	}
	for (const g of byExercise) g.sets.sort((a, b) => a.setIndex - b.setIndex);

	return {
		session: {
			id: s.id,
			name: s.name,
			startedAt: s.startedAt,
			endedAt: s.endedAt,
			durationSec:
				s.endedAt && s.startedAt
					? Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 1000)
					: null,
			totalVolumeKg: s.totalVolumeKg,
			estimatedKcal: s.estimatedKcal,
			kcalSource: s.kcalSource,
			avgHr: s.avgHr,
			readinessScore: s.readinessScore,
			bodyweightKg: s.bodyweightKg
		},
		volumeByMuscle,
		exercises: byExercise
	};
};

export const actions: Actions = {
	editTimes: async ({ params, request }) => {
		const fd = await request.formData();
		const start = Number(fd.get('startedAt'));
		const end = Number(fd.get('endedAt'));
		if (!Number.isFinite(start) || !Number.isFinite(end)) return fail(400, { timeError: 'Pick a start and end' });
		if (end <= start) return fail(400, { timeError: 'End must be after start' });
		if (end - start > 6 * 3600_000) return fail(400, { timeError: 'That is over 6 hours, check the times' });
		const s = repo.updateSessionTimes(Number(params.id), { startedAt: new Date(start), endedAt: new Date(end) });
		if (!s) return fail(404, { timeError: 'Workout not found' });
		return { timesSaved: true };
	},
	editSet: async ({ params, request }) => {
		const fd = await request.formData();
		const reps = Number(fd.get('reps'));
		const weightKg = Number(fd.get('weightKg'));
		if (!Number.isInteger(reps) || reps < 1) return fail(400, { error: 'Reps must be at least 1' });
		if (!Number.isFinite(weightKg) || weightKg < 0) return fail(400, { error: 'Enter a weight' });
		const row = repo.updateSet(Number(params.id), Number(fd.get('setId')), { reps, weightKg });
		if (!row) return fail(404, { error: 'Set not found' });
		return { ok: true };
	},
	deleteSet: async ({ params, request }) => {
		const fd = await request.formData();
		repo.deleteSet(Number(params.id), Number(fd.get('setId')));
		return { ok: true };
	},
	delete: async ({ params }) => {
		const id = Number(params.id);
		if (!id) return fail(400, { error: 'missing id' });
		repo.deleteSession(id);
		throw redirect(303, '/history');
	}
};
