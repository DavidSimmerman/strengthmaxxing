/**
 * Pure training math — shared by the API, dashboard and coach.
 * No DB, no I/O, so it's trivially testable (see demo() at the bottom).
 */

/** Estimated 1-rep max (Epley). reps=1 returns the weight itself. */
export function e1rm(weightKg: number, reps: number): number {
	if (reps <= 0 || weightKg <= 0) return 0;
	if (reps === 1) return weightKg;
	return weightKg * (1 + reps / 30);
}

/** Total tonnage (kg lifted) = Σ reps·weight over the given sets. */
export function tonnage(sets: { reps: number; weightKg: number }[]): number {
	return sets.reduce((t, s) => t + s.reps * s.weightKg, 0);
}

/**
 * Fatigue signal from per-rep completion offsets (ms from the set's first rep).
 * Rising inter-rep gaps = the lifter slowing = fatigue. Returns:
 *  - decayPct: how much slower the last third of reps is vs the first third (0 = none)
 *  - grinders: reps whose gap exceeded 1.5× the median gap (near-failure reps)
 *  - avgRepMs: mean inter-rep interval
 */
export function repFatigue(offsetsMs: number[]): {
	decayPct: number;
	grinders: number;
	avgRepMs: number;
} {
	if (offsetsMs.length < 3) return { decayPct: 0, grinders: 0, avgRepMs: 0 };
	const gaps: number[] = [];
	for (let i = 1; i < offsetsMs.length; i++) gaps.push(offsetsMs[i] - offsetsMs[i - 1]);
	const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
	const third = Math.max(1, Math.floor(gaps.length / 3));
	const first = avg(gaps.slice(0, third));
	const last = avg(gaps.slice(-third));
	const sorted = [...gaps].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];
	const grinders = gaps.filter((g) => g > median * 1.5).length;
	const decayPct = first > 0 ? Math.max(0, (last - first) / first) * 100 : 0;
	return { decayPct: Math.round(decayPct), grinders, avgRepMs: Math.round(avg(gaps)) };
}

/**
 * Estimated ACTIVE energy (kcal) for a session — what Apple calls Active Calories, i.e. on top
 * of what you'd burn at rest anyway, so it's comparable with the watch's number.
 * MET formula: kcal/min = (MET − 1) · 3.5 · bodyweightKg / 200. Working sets burn at the
 * exercise's MET; rest between sets at ~1.5 MET; never below SESSION_MET for the whole session.
 * Only a fallback: sessions with Apple Watch or heart-rate calories keep those instead.
 */
export function estimateKcal(
	workingSets: { met: number; activeMin: number }[],
	restMin: number,
	bodyweightKg: number
): number {
	const bw = bodyweightKg > 0 ? bodyweightKg : 80;
	const factor = (3.5 * bw) / 200;
	const active = workingSets.reduce((k, s) => k + Math.max(0, s.met - 1) * factor * s.activeMin, 0);
	const rest = 0.5 * factor * restMin;
	// Rep time alone (~3 s/rep) badly undercounts a lifting session. The Compendium of Physical
	// Activities rates a whole resistance-training session, rests included, at ~3.5 MET, so
	// never estimate below that for the session's full length.
	const totalMin = workingSets.reduce((m, s) => m + s.activeMin, 0) + restMin;
	const session = (SESSION_MET - 1) * factor * totalMin;
	return Math.round(Math.max(active + rest, session));
}

/** Compendium of Physical Activities: resistance training, multiple exercises, 8-15 reps. */
export const SESSION_MET = 3.5;

/**
 * Daily readiness 0-100 from recovery inputs. Higher = train hard, lower = dial back.
 * Drives the coach's auto-progression. Every input is optional — unknowns don't penalize.
 * ponytail: linear heuristic with a tunable baseline; swap for a fitted model once there's data.
 */
export function readinessScore(i: {
	sleepHours?: number | null;
	kcalBalance?: number | null; // negative = deficit
	hrvMs?: number | null;
	hrvBaselineMs?: number | null;
	restingHr?: number | null;
	restingHrBaseline?: number | null;
	sorenessLevel?: number | null; // 0 (fresh) .. 3 (very sore)
}): number {
	let s = 75;
	if (i.sleepHours != null) s += clamp((i.sleepHours - 7.5) * 6, -25, 12);
	if (i.kcalBalance != null && i.kcalBalance < -500) s += clamp((i.kcalBalance + 500) / 60, -15, 0);
	if (i.hrvMs != null && i.hrvBaselineMs) s += clamp(((i.hrvMs - i.hrvBaselineMs) / i.hrvBaselineMs) * 40, -15, 15);
	if (i.restingHr != null && i.restingHrBaseline)
		s += clamp((i.restingHrBaseline - i.restingHr) * 1.5, -12, 8);
	if (i.sorenessLevel != null) s -= i.sorenessLevel * 6;
	return Math.round(clamp(s, 0, 100));
}

/** Suggested load multiplier from readiness. 100 → 1.0, low → dial back, high → push. */
export function loadMultiplier(readiness: number): number {
	// 50 is neutral-ish; ±1% per point away from 75, capped ±10%.
	return +clamp(1 + (readiness - 75) * 0.004, 0.9, 1.1).toFixed(3);
}

function clamp(x: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, x));
}

// --- self-check: `node --experimental-strip-types src/lib/metrics.ts` ---
function demo() {
	const assert = (c: boolean, m: string) => {
		if (!c) throw new Error('FAIL: ' + m);
	};
	assert(e1rm(100, 1) === 100, 'e1rm single');
	assert(Math.abs(e1rm(100, 10) - 133.33) < 0.1, 'e1rm epley');
	assert(tonnage([{ reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 }]) === 1000, 'tonnage');
	const f = repFatigue([0, 1000, 2000, 3200, 4600, 6400]); // gaps grow → fatigue
	assert(f.decayPct > 0, 'fatigue detects slowdown');
	const steady = repFatigue([0, 1000, 2000, 3000, 4000]);
	assert(steady.decayPct === 0, 'steady = no decay');
	assert(estimateKcal([{ met: 6, activeMin: 10 }], 20, 80) > 0, 'kcal positive');
	assert(readinessScore({ sleepHours: 9, hrvMs: 70, hrvBaselineMs: 60 }) > 75, 'good day = high');
	assert(readinessScore({ sleepHours: 4, sorenessLevel: 3, kcalBalance: -900 }) < 60, 'bad day = low');
	assert(loadMultiplier(100) > 1 && loadMultiplier(40) < 1, 'load scales with readiness');
	console.log('metrics.ts: all self-checks passed ✓');
}
if (import.meta.url === `file://${process.argv[1]}`) demo();
