import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sessionSets } from '$lib/db/schema';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

const AGENT_URL = env.AGENT_URL || 'http://localhost:8787';

const TIME_OF_DAY = (hour: number): string => {
	if (hour < 5) return 'night';
	if (hour < 12) return 'morning';
	if (hour < 17) return 'afternoon';
	if (hour < 21) return 'evening';
	return 'night';
};

function todayIso(): string {
	// YYYY-MM-DD in local time to match readiness keys.
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

// Most recent performed (non-warmup) set for a given exercise, across all sessions.
function lastPerformedSet(exerciseId: number) {
	return db
		.select({ weightKg: sessionSets.weightKg, reps: sessionSets.reps })
		.from(sessionSets)
		.where(and(eq(sessionSets.exerciseId, exerciseId), eq(sessionSets.isWarmup, false)))
		.orderBy(desc(sessionSets.completedAt))
		.limit(1)
		.get();
}

// POST /api/coach/progress body {workoutId,date?} → assembles context, forwards to agent /progress
export const POST: RequestHandler = async ({ request, fetch }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	if (typeof b.workoutId !== 'number') throw error(400, 'workoutId is required and must be a number');
	if (b.date !== undefined && typeof b.date !== 'string') throw error(400, 'date must be a string');

	// Load the workout + its exercises.
	let workout;
	try {
		workout = await repo.getWorkout(b.workoutId);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load workout');
	}
	if (!workout) throw error(404, 'workout not found');

	// Per-exercise: last performed weight/reps.
	const exercises = workout.exercises.map((we) => {
		let last: { weightKg: number; reps: number } | undefined;
		try {
			last = lastPerformedSet(we.exerciseId);
		} catch {
			last = undefined;
		}
		return {
			name: we.exercise.name,
			lastWeightKg: last?.weightKg ?? null,
			lastReps: last?.reps ?? null,
			targetReps: we.targetReps
		};
	});

	// Today's readiness row (date override allowed, else current YYYY-MM-DD).
	const date = (b.date as string | undefined) ?? todayIso();
	let readinessRow;
	try {
		readinessRow = repo.getReadiness(date);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load readiness');
	}

	const payload = {
		workout: { name: workout.name, exercises },
		readiness: readinessRow?.score ?? null,
		context: {
			timeOfDay: TIME_OF_DAY(new Date().getHours()),
			kcalBalance: readinessRow?.kcalBalance ?? null,
			sleepHours: readinessRow?.sleepHours ?? null,
			sorenessNote: readinessRow?.sorenessNote ?? null
		}
	};

	let res: Response;
	try {
		res = await fetch(`${AGENT_URL}/progress`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(payload)
		});
	} catch (e) {
		throw error(502, e instanceof Error ? e.message : 'coach agent unreachable');
	}
	if (!res.ok) throw error(502, `coach agent error (${res.status})`);

	let data: unknown;
	try {
		data = await res.json();
	} catch {
		throw error(502, 'coach agent returned invalid JSON');
	}
	return json(data);
};
