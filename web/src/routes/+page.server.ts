import { redirect, fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import * as repo from '$lib/server/repo';
import { db } from '$lib/db';
import { sessionSets } from '$lib/db/schema';
import { e1rm } from '$lib/metrics';
import { isoDay } from '$lib/ui';
import { currentNotes, dismissNote, ensureTodayNote } from '$lib/server/notes';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Today's coach note is written in the background; it shows on the next visit (or refresh).
	void ensureTodayNote();
	const today = isoDay();
	const readiness = repo.getReadiness(today) ?? null;

	const exerciseName = new Map(repo.listExercises().map((e) => [e.id, e.name]));

	// find an in-progress session (endedAt null), newest first
	const recent = repo.listSessions(30);
	const active = recent.find((s) => s.endedAt == null) ?? null;
	const activeSetCount = active
		? db.select({ id: sessionSets.id }).from(sessionSets).where(eq(sessionSets.sessionId, active.id))
				.all().length
		: 0;

	// recent PRs: best e1rm per exercise across the last finished sessions.
	// Read raw sets + exercise join directly (fast, no relational-query reps shadowing).
	const finished = recent.filter((s) => s.endedAt != null).slice(0, 12);
	const prMap = new Map<
		string,
		{ exercise: string; e1rm: number; weightKg: number; reps: number; when: Date }
	>();
	for (const s of finished) {
		const rows = db
			.select({
				reps: sessionSets.reps,
				weightKg: sessionSets.weightKg,
				isWarmup: sessionSets.isWarmup,
				exerciseId: sessionSets.exerciseId
			})
			.from(sessionSets)
			.where(eq(sessionSets.sessionId, s.id))
			.all();
		for (const set of rows) {
			if (set.isWarmup || set.reps <= 0) continue;
			const val = +e1rm(set.weightKg, set.reps).toFixed(1);
			const name = exerciseName.get(set.exerciseId) ?? `#${set.exerciseId}`;
			const cur = prMap.get(name);
			if (!cur || val > cur.e1rm) {
				prMap.set(name, {
					exercise: name,
					e1rm: val,
					weightKg: set.weightKg,
					reps: set.reps,
					when: s.startedAt
				});
			}
		}
	}
	const prs = [...prMap.values()].sort((a, b) => b.e1rm - a.e1rm).slice(0, 6);

	const workouts = await repo.listWorkouts();

	return {
		today,
		readiness,
		active: active
			? {
					id: active.id,
					name: active.name,
					startedAt: active.startedAt,
					setCount: activeSetCount
				}
			: null,
		prs,
		workouts: workouts.map((w) => ({ id: w.id, name: w.name, exerciseCount: w.exercises.length })),
		notes: currentNotes()
	};
};

export const actions: Actions = {
	dismissNote: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		if (Number.isInteger(id)) dismissNote(id);
		return { ok: true };
	},
	// start an ad-hoc or template session, jump straight into logging
	start: async ({ request }) => {
		const fd = await request.formData();
		const workoutId = fd.get('workoutId') ? Number(fd.get('workoutId')) : null;
		const name = (fd.get('name') as string) || 'Ad-hoc session';
		const today = isoDay();
		const readiness = repo.getReadiness(today);
		let sessionName = name;
		if (workoutId) {
			const w = await repo.getWorkout(workoutId);
			if (!w) return fail(404, { error: 'Workout not found' });
			sessionName = w.name;
		}
		const s = repo.startSession({
			workoutId,
			name: sessionName,
			source: 'web',
			readinessScore: readiness?.score ?? null
		});
		throw redirect(303, `/session/${s.id}`);
	},

	// throw away an unfinished workout (e.g. started by mistake or left open overnight)
	discard: async ({ request }) => {
		const id = Number((await request.formData()).get('id'));
		const s = repo.getSession(id);
		if (!s || s.endedAt) return fail(400, { error: 'Only an unfinished workout can be discarded' });
		repo.deleteSession(id);
		return { ok: true };
	},

	// quick readiness log for the day (manual, when healthmaxxing hasn't pushed)
	readiness: async ({ request }) => {
		const fd = await request.formData();
		const numOrNull = (k: string) => (fd.get(k) ? Number(fd.get(k)) : null);
		repo.upsertReadiness(isoDay(), {
			sleepHours: numOrNull('sleepHours'),
			sorenessLevel: numOrNull('sorenessLevel'),
			kcalBalance: numOrNull('kcalBalance')
		});
		return { ok: true };
	}
};
