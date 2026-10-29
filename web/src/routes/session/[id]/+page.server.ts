import { error, redirect, fail } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import { e1rm } from '$lib/metrics';
import { estimateSetSec, SWITCH_SEC } from '$lib/rest';
import type { Actions, PageServerLoad } from './$types';
import type { SessionPlan } from '$lib/server/today';
const KG_PER_LB = 0.45359237;

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
		perSide: boolean;
		orderIndex: number;
	};

	// planned = template slots, then exercises added mid-session, then anything logged that
	// is in neither (e.g. a set synced from the watch) — so nothing logged is ever hidden.
	const removed = new Set(session.removedExerciseIds ?? []);
	// A generated session (dynamic coach) carries its own plan instead of a template.
	const generated = (session.plan as SessionPlan | null)?.exercises ?? [];
	const lib0 = new Map(repo.listExercises().map((e) => [e.id, e]));
	const fromPlan: Planned[] = generated
		.filter((x) => !removed.has(x.exerciseId) && lib0.has(x.exerciseId))
		.map((x, i) => ({
			exerciseId: x.exerciseId,
			name: x.exercise,
			muscle: lib0.get(x.exerciseId)!.muscle,
			category: x.category,
			targetSets: x.sets,
			targetReps: x.targetReps,
			targetWeightKg: (x.weightLb ?? 0) * KG_PER_LB,
			restSec: x.restSec,
			supersetGroup: x.supersetGroup,
			perSide: false,
			orderIndex: i
		}));
	const planned: Planned[] = template ? [] : fromPlan;
	planned.push(...(template?.exercises ?? []).filter((we) => !removed.has(we.exerciseId)).map((we) => ({
		exerciseId: we.exerciseId,
		name: we.exercise.name,
		muscle: we.exercise.muscle,
		category: we.exercise.category,
		targetSets: we.targetSets,
		targetReps: we.targetReps,
		targetWeightKg: we.targetWeightKg,
		restSec: we.restSec,
		supersetGroup: we.supersetGroup,
		perSide: we.perSide,
		orderIndex: we.orderIndex
	})));
	const lib = new Map(repo.listExercises().map((e) => [e.id, e]));
	const adHoc = (exerciseId: number, weightKg = 0, supersetGroup: number | null = null) => {
		const e = lib.get(exerciseId);
		if (!e || planned.some((p) => p.exerciseId === exerciseId)) return;
		planned.push({
			exerciseId,
			name: e.name,
			muscle: e.muscle,
			category: e.category,
			targetSets: 3,
			targetReps: 8,
			targetWeightKg: weightKg,
			restSec: e.defaultRestSec,
			supersetGroup,
			perSide: session.sets.some((s) => s.exerciseId === exerciseId && s.side != null),
			orderIndex: planned.length
		});
	};
	for (const id of session.extraExerciseIds ?? []) adHoc(id);
	for (const set of session.sets) adHoc(set.exerciseId, set.weightKg, set.supersetGroup);

	// logged sets grouped by exercise
	const setsByExercise = new Map<number, typeof session.sets>();
	for (const s of session.sets) {
		const arr = setsByExercise.get(s.exerciseId) ?? [];
		arr.push(s);
		setsByExercise.set(s.exerciseId, arr);
	}

	const last = repo.lastPerformance(planned.map((p) => p.exerciseId), id);
	const best = repo.bestE1rmByExercise(id);

	const sug = (session.suggestions ?? null) as import('$lib/server/coach').SessionSuggestions | null;
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
				side: s.side,
				volume: s.reps * s.weightKg
			})),
			lastTime: last.get(p.exerciseId) ?? null,
			suggestion: sug?.items?.[p.exerciseId] ?? null,
			bestE1rm: best.get(p.exerciseId) ?? 0,
			lastWeight: done.length
				? done[done.length - 1].weightKg
				: p.targetWeightKg || (last.get(p.exerciseId)?.sets.at(-1)?.weightKg ?? 0),
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
			readinessScore: session.readinessScore,
			checkin: session.checkin ?? null
		},
		suggestions: sug ? { status: sug.status, summary: sug.summary ?? '', error: sug.error ?? '' } : null,
		exercises,
		library,
		totalVolume,
		totalSets
	};
};

function setFields(fd: FormData) {
	const reps = Number(fd.get('reps'));
	const weightKg = Number(fd.get('weightKg'));
	if (!Number.isInteger(reps) || reps < 1) return { error: 'Reps must be at least 1' } as const;
	if (fd.get('weightKg') === '' || !Number.isFinite(weightKg) || weightKg < 0)
		return { error: 'Enter a weight (0 for bodyweight)' } as const;
	return { reps, weightKg } as const;
}

export const actions: Actions = {
	addSet: async ({ params, request }) => {
		const id = Number(params.id);
		const fd = await request.formData();
		const exerciseId = Number(fd.get('exerciseId'));
		const f = setFields(fd);
		if (!exerciseId) return fail(400, { error: 'Pick an exercise' });
		if ('error' in f) return fail(400, { error: f.error });
		const session = repo.getSession(id);
		if (!session) return fail(404, { error: 'Session not found' });
		if (session.endedAt) return fail(409, { error: 'This workout is already finished' });
		const before = repo.bestE1rmByExercise(id).get(exerciseId) ?? 0;
		const thisSession = session.sets
			.filter((s) => s.exerciseId === exerciseId && !s.isWarmup)
			.reduce((m, s) => Math.max(m, e1rm(s.weightKg, s.reps)), 0);
		const isWarmup = fd.get('isWarmup') === 'true';
		const base = {
			exerciseId,
			setIndex: Number(fd.get('setIndex') ?? 0),
			supersetGroup: fd.get('supersetGroup') ? Number(fd.get('supersetGroup')) : null,
			weightKg: f.weightKg,
			isWarmup
		};
		const repsR = Number(fd.get('repsR'));
		if (fd.has('repsR')) {
			if (!Number.isInteger(repsR) || repsR < 1) return fail(400, { error: 'Right-side reps must be at least 1' });
			// Logged together after the right side: the left side finished one right-side set
			// (plus a few seconds to switch) earlier.
			const now = Date.now();
			const ex = repo.listExercises().find((e) => e.id === exerciseId);
			const rightSec = estimateSetSec(ex?.category ?? 'machine', repsR, repo.secPerRep(exerciseId));
			repo.addSet(id, { ...base, side: 'L', reps: f.reps, completedAt: now - (rightSec + SWITCH_SEC) * 1000 });
			repo.addSet(id, { ...base, side: 'R', reps: repsR, completedAt: now });
		} else repo.addSet(id, { ...base, reps: f.reps });
		// PR = beats every earlier set of this exercise, ever (needs some history to mean anything)
		const now = e1rm(f.weightKg, fd.has('repsR') ? Math.max(f.reps, repsR) : f.reps);
		const pr = !isWarmup && before > 0 && now > Math.max(before, thisSession) ? now : null;
		return { ok: true, loggedExercise: exerciseId, pr };
	},

	editSet: async ({ params, request }) => {
		const fd = await request.formData();
		const f = setFields(fd);
		if ('error' in f) return fail(400, { error: f.error });
		const row = repo.updateSet(Number(params.id), Number(fd.get('setId')), f);
		if (!row) return fail(404, { error: 'Set not found' });
		if (fd.get('setIdR')) {
			const repsR = Number(fd.get('repsR'));
			if (!Number.isInteger(repsR) || repsR < 1) return fail(400, { error: 'Right-side reps must be at least 1' });
			repo.updateSet(Number(params.id), Number(fd.get('setIdR')), { reps: repsR, weightKg: f.weightKg });
		}
		return { ok: true };
	},

	deleteSet: async ({ params, request }) => {
		const fd = await request.formData();
		repo.deleteSet(Number(params.id), Number(fd.get('setId')));
		if (fd.get('setIdR')) repo.deleteSet(Number(params.id), Number(fd.get('setIdR')));
		return { ok: true };
	},

	addExercise: async ({ params, request }) => {
		const fd = await request.formData();
		const exerciseId = Number(fd.get('exerciseId'));
		if (!exerciseId) return fail(400, { error: 'Pick an exercise' });
		repo.addSessionExercise(Number(params.id), exerciseId);
		return { ok: true };
	},

	removeExercise: async ({ params, request }) => {
		const fd = await request.formData();
		const exerciseId = Number(fd.get('exerciseId'));
		if (!exerciseId) return fail(400, { error: 'Pick an exercise' });
		if (!repo.removeSessionExercise(Number(params.id), exerciseId))
			return fail(409, { error: 'This workout is already finished' });
		return { ok: true };
	},

	discard: async ({ params }) => {
		const id = Number(params.id);
		const s = repo.getSession(id);
		if (s && !s.endedAt) repo.deleteSession(id);
		throw redirect(303, '/');
	},

	finish: async ({ params, request }) => {
		const id = Number(params.id);
		const fd = await request.formData();
		const notes = (fd.get('notes') as string) || undefined;
		const bw = fd.get('bodyweightKg') ? Number(fd.get('bodyweightKg')) : undefined;
		// Inside the iPhone app the page adds heart-rate calories from Apple Health.
		const kcal = Number(fd.get('activeKcal'));
		const avgHr = Number(fd.get('avgHr'));
		const measured =
			fd.get('activeKcal') && Number.isFinite(kcal) && kcal >= 0 && kcal <= 5000
				? { activeKcal: kcal, avgHr: avgHr >= 30 && avgHr <= 250 ? avgHr : null, kcalSource: 'heart_rate' as const }
				: undefined;
		repo.finishSession(id, {
			notes,
			bodyweightKg: bw && bw >= 25 && bw <= 350 ? bw : undefined,
			measured
		});
		throw redirect(303, `/history/${id}`);
	}
};
