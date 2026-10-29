/**
 * Read-only feed from healthmaxxing (GET /api/integrations/strength-feed): other training from
 * Apple Health (runs, basketball…), food log, sleep / HRV / resting HR, body composition and
 * the diet goal. Optional — with HEALTHMAXXING_TOKEN unset, or the app unreachable, every
 * caller just gets null and the coach works from lifting data alone.
 */
import { env } from '$env/dynamic/private';
import type { Activity } from '$lib/coach/engine';

export type HealthFeed = {
	days: number;
	workouts: { name: string; startedAt: string; endedAt: string | null; distanceKm: number | null; avgHr: number | null; kcal: number | null }[];
	food: { loggedAt: string; calories: number; proteinG: number }[];
	daily: Record<string, { sleepMin?: number; hrvMs?: number; restingHr?: number }>;
	body: { measuredAt: string; weightKg: number; bodyFatPct: number | null; leanMassKg: number | null }[];
	profile: {
		heightCm: number | null;
		sex: string | null;
		birthDate: string | null;
		calorieTarget: number;
		proteinTargetG: number;
		goalMode: string;
		goalBodyFatPct: number | null;
	} | null;
};

const TTL_MS = 5 * 60_000;
const cache = new Map<number, { at: number; feed: HealthFeed | null }>();

export async function healthFeed(days = 7): Promise<HealthFeed | null> {
	const token = env.HEALTHMAXXING_TOKEN;
	if (!token) return null;
	const hit = cache.get(days);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.feed;
	const base = env.HEALTHMAXXING_URL || 'https://healthmaxxing.simmerman.tech';
	let feed: HealthFeed | null = null;
	try {
		const r = await fetch(new URL(`/api/integrations/strength-feed?days=${days}`, base), {
			headers: { authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(4000)
		});
		if (r.ok) feed = (await r.json()) as HealthFeed;
		else console.warn(`healthmaxxing feed: HTTP ${r.status}`);
	} catch (e) {
		console.warn('healthmaxxing feed unreachable:', e instanceof Error ? e.message : e);
	}
	cache.set(days, { at: Date.now(), feed });
	return feed;
}

/** Other training as engine activities (leg fatigue from runs, basketball…). */
export function feedActivities(feed: HealthFeed | null): Activity[] {
	return (feed?.workouts ?? []).map((w) => {
		const start = new Date(w.startedAt);
		const end = w.endedAt ? new Date(w.endedAt) : start;
		return {
			at: end, // fatigue starts when the session ends
			kind: w.name,
			minutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000)),
			km: w.distanceKm
		};
	});
}

/** Is the diet goal a deficit? null = unknown (no feed). */
export function feedCutting(feed: HealthFeed | null): boolean | null {
	const m = feed?.profile?.goalMode;
	return m ? m === 'cut' || m === 'aggressive_cut' : null;
}
