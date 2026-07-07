import { eq } from 'drizzle-orm';
import * as repo from '$lib/server/repo';
import { db } from '$lib/db';
import { sessionSets, repEvents, exercises } from '$lib/db/schema';
import { e1rm, repFatigue } from '$lib/metrics';
import { isoDay } from '$lib/ui';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const finished = repo
		.listSessions(60)
		.filter((s) => s.endedAt != null)
		.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime()); // oldest → newest

	const muscleOf = new Map(db.select().from(exercises).all().map((e) => [e.id, e.muscle]));

	// enrich each session with per-set fatigue, best e1rm, muscle volume — computed here
	// from raw rows (repo.sessionExport is unusable: it reads an un-awaited relational query).
	const enriched = finished.map((s) => {
		const sets = db
			.select({
				id: sessionSets.id,
				exerciseId: sessionSets.exerciseId,
				reps: sessionSets.reps,
				weightKg: sessionSets.weightKg,
				isWarmup: sessionSets.isWarmup
			})
			.from(sessionSets)
			.where(eq(sessionSets.sessionId, s.id))
			.all();

		const byMuscle: Record<string, number> = {};
		const decays: number[] = [];
		let bestE1rm = 0;
		for (const set of sets) {
			if (set.isWarmup) continue;
			bestE1rm = Math.max(bestE1rm, e1rm(set.weightKg, set.reps));
			const m = muscleOf.get(set.exerciseId) ?? 'other';
			byMuscle[m] = (byMuscle[m] ?? 0) + set.reps * set.weightKg;
			const offsets = db
				.select({ offsetMs: repEvents.offsetMs, repIndex: repEvents.repIndex })
				.from(repEvents)
				.where(eq(repEvents.sessionSetId, set.id))
				.all()
				.sort((a, b) => a.repIndex - b.repIndex)
				.map((r) => r.offsetMs);
			const f = repFatigue(offsets);
			if (f.decayPct > 0) decays.push(f.decayPct);
		}
		const avgDecay = decays.length ? decays.reduce((a, b) => a + b, 0) / decays.length : 0;

		return {
			id: s.id,
			name: s.name,
			startedAt: s.startedAt,
			day: isoDay(s.startedAt),
			totalVolumeKg: s.totalVolumeKg,
			estimatedKcal: s.estimatedKcal,
			readinessScore: s.readinessScore,
			avgDecay: Math.round(avgDecay),
			bestE1rm: Math.round(bestE1rm * 10) / 10,
			byMuscle
		};
	});

	// aggregate volume-by-muscle across all sessions
	const muscleTotals: Record<string, number> = {};
	for (const e of enriched)
		for (const [m, v] of Object.entries(e.byMuscle)) muscleTotals[m] = (muscleTotals[m] ?? 0) + v;

	// off-day detector: rolling avg (window 3) of volume; flag sessions where volume dropped
	// >20% below rolling avg OR avg fatigue decay was high (>25%).
	const flagged = enriched.map((e, i) => {
		const window = enriched.slice(Math.max(0, i - 3), i);
		const rollAvg = window.length
			? window.reduce((a, b) => a + b.totalVolumeKg, 0) / window.length
			: e.totalVolumeKg;
		const volDrop = rollAvg > 0 ? (rollAvg - e.totalVolumeKg) / rollAvg : 0;
		const offDay = (volDrop > 0.2 && window.length >= 2) || e.avgDecay > 25;
		return { ...e, rollAvg: Math.round(rollAvg), volDropPct: Math.round(volDrop * 100), offDay };
	});

	// readiness trend from the readiness table across the session days
	const days = [...new Set(enriched.map((e) => e.day))];
	const readinessTrend = days
		.map((d) => {
			const r = repo.getReadiness(d);
			return r && r.score != null ? { day: d, score: r.score } : null;
		})
		.filter((x): x is { day: string; score: number } => x != null);

	return {
		sessions: flagged,
		muscleTotals,
		readinessTrend,
		strengthVsReadiness: flagged
			.filter((s) => s.readinessScore != null && s.bestE1rm > 0)
			.map((s) => ({ x: s.readinessScore as number, y: s.bestE1rm, label: s.name, hot: s.offDay }))
	};
};
