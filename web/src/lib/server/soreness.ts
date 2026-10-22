/**
 * Body areas for the start-of-workout check-in, and an estimate of how sore each probably is
 * from recent training: every hard set in the last 4 days counts, fading with time.
 */
import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { exercises, sessions, sessionSets } from '$lib/db/schema';

export const AREAS = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'] as const;
export type Area = (typeof AREAS)[number];

const MUSCLE_AREA: Record<string, Area> = {
	chest: 'Chest',
	back: 'Back',
	shoulders: 'Shoulders',
	biceps: 'Arms',
	triceps: 'Arms',
	quads: 'Legs',
	hamstrings: 'Legs',
	glutes: 'Legs',
	calves: 'Legs',
	core: 'Core'
};
export const muscleArea = (muscle: string): Area => MUSCLE_AREA[muscle.toLowerCase()] ?? 'Core';

// Share of a set's soreness left after N hours (DOMS peaks ~1-2 days, mostly gone by 4).
function fade(hours: number) {
	if (hours < 24) return 1;
	if (hours < 48) return 0.8;
	if (hours < 72) return 0.45;
	if (hours < 96) return 0.15;
	return 0;
}

export type SorenessEstimate = Record<Area, { level: 0 | 1 | 2; reason: string | null }>;

export function estimateSoreness(now = new Date()): SorenessEstimate {
	const since = new Date(now.getTime() - 96 * 3600_000);
	const rows = db
		.select({
			muscle: exercises.muscle,
			sessionName: sessions.name,
			sessionId: sessions.id,
			at: sessions.startedAt
		})
		.from(sessionSets)
		.innerJoin(sessions, eq(sessionSets.sessionId, sessions.id))
		.innerJoin(exercises, eq(sessionSets.exerciseId, exercises.id))
		.where(and(gte(sessions.startedAt, since), eq(sessionSets.isWarmup, false)))
		.all();
	const load = new Map<Area, number>();
	const latest = new Map<Area, { name: string; at: Date; sets: number; sessionId: number }>();
	for (const r of rows) {
		const area = muscleArea(r.muscle);
		load.set(area, (load.get(area) ?? 0) + fade((now.getTime() - r.at.getTime()) / 3600_000));
		const cur = latest.get(area);
		if (!cur || r.at > cur.at) latest.set(area, { name: r.sessionName, at: r.at, sets: 1, sessionId: r.sessionId });
		else if (cur.sessionId === r.sessionId) cur.sets++;
	}
	const out = {} as SorenessEstimate;
	for (const area of AREAS) {
		const l = load.get(area) ?? 0;
		const level = l >= 9 ? 2 : l >= 4 ? 1 : 0;
		const last = latest.get(area);
		const days = last ? Math.floor((now.getTime() - last.at.getTime()) / 864e5) : 0;
		const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
		out[area] = { level, reason: level && last ? `${last.name} ${when}, ${last.sets} hard sets` : null };
	}
	return out;
}
