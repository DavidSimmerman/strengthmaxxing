/**
 * The dynamic coach's maths: per-muscle fatigue and weekly volume, today's muscle selection,
 * and per-exercise weight × reps / rest prescriptions. Pure functions, no DB — the server
 * gathers history and calls these; Claude only picks and explains within what this allows.
 *
 * Research behind each number: https://plan.simmerman.cc/p/strengthmaxxing-dynamic-coach
 */
import { MUSCLES, LEG_MUSCLES, MUSCLE_GROUP, STRENGTH, profileFor, primaryMuscle, type Muscle, type ExerciseProfile } from './muscles.ts';
import { nextLb } from '../equipment.ts';
import { estimateSetSec } from '../rest.ts';

const H = 3600_000;
const LB = 0.45359237;

// ---------- inputs ----------

export type LoggedSet = {
	at: Date;
	exercise: string;
	muscle?: string; // legacy single muscle, for exercises with no profile
	reps: number;
	weightKg: number;
	rir?: number | null; // reps in reserve, when tapped
	isWarmup?: boolean;
	sessionId?: number;
};

/** Other training from Apple Health (via healthmaxxing): runs, basketball… */
export type Activity = { at: Date; kind: string; minutes: number; km?: number | null };

export type Tier = 'grow' | 'build' | 'maintain' | 'athletic';
export type Soreness = Partial<Record<Muscle, 0 | 1 | 2>>; // fresh / a bit / very

export type CoachSettings = {
	tiers: Record<Muscle, Tier>;
	cutting: boolean;
	/** Recovery time constant (hours) per muscle; learned, default 30. */
	tauH?: Partial<Record<Muscle, number>>;
	/** Extra weekly sets for lagging muscles (from the balance score). */
	lagBonus?: Partial<Record<Muscle, number>>;
};

/** David's priorities (Oct 27, 2026): everything, core and arms/shoulders most; legs athletic. */
export const DAVID_TIERS: Record<Muscle, Tier> = {
	chest: 'grow',
	frontDelts: 'maintain', // pressing covers them
	sideDelts: 'grow',
	rearDelts: 'build',
	lats: 'build',
	upperBack: 'build',
	biceps: 'grow',
	triceps: 'grow',
	abs: 'grow',
	obliques: 'build',
	quads: 'athletic',
	hamstrings: 'athletic',
	glutes: 'athletic',
	calves: 'athletic'
};

// ---------- volume and fatigue ----------

/** Weekly fractional hard-set targets per tier (Schoenfeld 2017; Pelland 2025). */
const TIER_SETS: Record<Tier, number> = { grow: 16, build: 12, maintain: 6, athletic: 8 };

export function weeklyTarget(m: Muscle, s: CoachSettings): number {
	const base = TIER_SETS[s.tiers[m]] * (s.cutting ? 0.85 : 1);
	return Math.round(base + (s.lagBonus?.[m] ?? 0));
}

/** How much a set counts: sets left far from failure (RIR ≥ 4) count half; warm-ups don't. */
function effort(rir: number | null | undefined) {
	return rir != null && rir >= 4 ? 0.5 : 1;
}

/** Fractional hard sets per muscle in the 7 days before `now`. */
export function weeklyVolume(sets: LoggedSet[], now: Date): Record<Muscle, number> {
	const out = zero();
	for (const s of sets) {
		if (s.isWarmup || s.at > now || now.getTime() - s.at.getTime() > 7 * 24 * H) continue;
		const p = profileFor(s.exercise, s.muscle);
		for (const [m, c] of entries(p.credits)) out[m] += c * effort(s.rir);
	}
	return out;
}

/** Fatigue a set leaves in each muscle: closer to failure and stretch-loaded cost more. */
function setDose(p: ExerciseProfile, rir: number | null | undefined) {
	const near = 1 - 0.1 * Math.min(4, rir ?? 1.5); // 0 RIR 1.0 … 3 RIR 0.7
	const out: Partial<Record<Muscle, number>> = {};
	for (const [m, c] of entries(p.credits)) {
		const leg = LEG_MUSCLES.includes(m) ? (p.legCost ?? 1) : 1;
		out[m] = c * near * (p.stretch ? 1.15 : 1) * leg;
	}
	return out;
}

/** Leg fatigue from other sports, in "hard set" units. A 5 km easy run ≈ 1.25 sets of quads. */
function activityDose(a: Activity): Partial<Record<Muscle, number>> {
	const k = a.kind.toLowerCase();
	if (k.includes('run')) {
		const km = a.km ?? a.minutes / 5.5;
		return { calves: 0.35 * km, quads: 0.25 * km, hamstrings: 0.15 * km, glutes: 0.15 * km };
	}
	if (k.includes('basketball') || k.includes('soccer') || k.includes('tennis') || k.includes('hiit')) {
		const u = a.minutes / 30;
		return { calves: 2 * u, quads: 1.5 * u, glutes: 1 * u, hamstrings: 1 * u };
	}
	if (k.includes('hike') || k.includes('cycl')) return { quads: a.minutes / 40, glutes: a.minutes / 80 };
	return {};
}

/** A typical session's fatigue in one muscle (6 hard sets): the scale for readiness. */
const SESSION_DOSE = 6;
export const DEFAULT_TAU_H = 30;

/** Readiness 0–1 per muscle: 1 = fully recovered. Fatigue fades as e^(−hours/τ). */
export function readiness(
	sets: LoggedSet[],
	activities: Activity[],
	now: Date,
	tauH: Partial<Record<Muscle, number>> = {}
): Record<Muscle, number> {
	const residual = zero();
	const add = (at: Date, dose: Partial<Record<Muscle, number>>) => {
		const h = (now.getTime() - at.getTime()) / H;
		if (h < 0 || h > 7 * 24) return;
		for (const [m, d] of entries(dose)) residual[m] += d * Math.exp(-h / (tauH[m] ?? DEFAULT_TAU_H));
	};
	for (const s of sets) if (!s.isWarmup) add(s.at, setDose(profileFor(s.exercise, s.muscle), s.rir));
	for (const a of activities) add(a.at, activityDose(a));
	const out = zero();
	for (const m of MUSCLES) out[m] = clamp(1 - residual[m] / SESSION_DOSE, 0, 1);
	return out;
}

// ---------- today's plan ----------

export type CheckIn = {
	energy: number | null; // 1–5
	soreness: Soreness;
	minutes: number; // time available
	/** Muscles the lifter doesn't want today ("not feeling legs"): their time goes to others. */
	skip?: Muscle[];
};

export type MuscleDay = {
	muscle: Muscle;
	sets: number; // hard sets planned today
	readiness: number;
	need: number; // sets still wanted this week
	reason: string;
};

/** Per-session cap per muscle (Remmert 2025 preprint: returns fade past ~6–8 hard sets). */
const SESSION_CAP: Record<Tier, number> = { grow: 8, build: 6, maintain: 4, athletic: 5 };
/** Don't train a muscle below this readiness unless it's barely being touched. */
const READY_MIN = 0.6;
/**
 * Days between sessions for a muscle. He trains every day, so the week is split rather than
 * crammed: priority muscles every other day, the rest every third (2⅓×/week; Schoenfeld 2016:
 * 2+ exposures a week; past that, weekly sets matter more than frequency — Pelland 2025).
 */
export const INTERVAL_DAYS: Record<Tier, number> = { grow: 2, build: 3, maintain: 3, athletic: 3 };
/** Muscles ready this soon before they're due can join a neighbour that is due (legs together). */
const PULL_FORWARD = 0.7;

export const intervalDays = (m: Muscle, s: CoachSettings) => INTERVAL_DAYS[s.tiers[m]];
/** Half a day of slack, so Monday evening → Wednesday lunch still counts as two days. */
const dueAfterH = (m: Muscle, s: CoachSettings) => intervalDays(m, s) * 24 - 12;
/** A day lighter than this gets topped up with the muscles closest to due. */
const MIN_DAY_SETS = 10;
/** …but never with a muscle less than ¾ of the way to due (nothing trained yesterday). */
const TOP_UP_DUE = 0.75;

/**
 * Hours since each muscle last had a real session (≥ 2.5 hard sets credited in one workout, so
 * a 2-set top-up or a press's help to triceps doesn't reset the clock). Missing = not trained
 * in the window.
 */
export function hoursSinceTrained(sets: LoggedSet[], now: Date): Partial<Record<Muscle, number>> {
	const bySession = new Map<string, { at: Date; dose: Partial<Record<Muscle, number>> }>();
	for (const st of sets) {
		if (st.isWarmup || st.at > now) continue;
		const k = String(st.sessionId ?? st.at.toISOString().slice(0, 10));
		const b = bySession.get(k) ?? { at: st.at, dose: {} };
		if (st.at > b.at) b.at = st.at;
		for (const [m, c] of entries(profileFor(st.exercise, st.muscle).credits)) b.dose[m] = (b.dose[m] ?? 0) + c * effort(st.rir);
		bySession.set(k, b);
	}
	const out: Partial<Record<Muscle, number>> = {};
	for (const { at, dose } of bySession.values())
		for (const [m, d] of entries(dose)) {
			if (d < 2.5) continue;
			const h = (now.getTime() - at.getTime()) / H;
			if (out[m] == null || h < out[m]!) out[m] = h;
		}
	return out;
}

/**
 * Which muscles today and how many sets each. Every day is a training day, so each muscle
 * gets a full session's share (weekly target ÷ sessions a week) when it is due, and waits for
 * a later day otherwise — no cramming the whole body into one day. A skipped day just leaves
 * more muscles due. Ranked by how far behind × priority × readiness; soreness trims or removes.
 * `sinceH` (hours since each muscle was last trained) turns on the due check; without it every
 * muscle counts as due.
 */
export function chooseMuscles(
	vol: Record<Muscle, number>,
	ready: Record<Muscle, number>,
	checkIn: CheckIn,
	s: CoachSettings,
	sinceH?: Partial<Record<Muscle, number>>
): MuscleDay[] {
	const energyMult = checkIn.energy == null ? 1 : [0.6, 0.75, 0.9, 1, 1.1][clamp(checkIn.energy, 1, 5) - 1];
	const prio: Record<Tier, number> = { grow: 1.3, build: 1, maintain: 0.7, athletic: 0.9 };
	const skip = new Set(checkIn.skip ?? []);
	// How far into its gap each muscle is: 1 = due now.
	const dueness = (m: Muscle) => {
		const h = sinceH?.[m];
		if (!sinceH || h == null) return 2;
		return h / dueAfterH(m, s);
	};
	const candidates: (MuscleDay & { score: number; due: number })[] = [];
	const extras: typeof candidates = []; // ready and nearly due, but the week's sets are already in
	for (const m of MUSCLES) {
		if (skip.has(m)) continue;
		const target = weeklyTarget(m, s);
		const need = Math.max(0, target - vol[m]);
		const sore = checkIn.soreness[m] ?? 0;
		let r = ready[m];
		if (sore === 1) r = Math.min(r, 0.7);
		if (sore === 2) r = 0;
		if (sore === 1 && s.tiers[m] === 'athletic') r = 0; // runner: sore legs sit out, keep them for running
		if (r < READY_MIN) continue;
		const tier = s.tiers[m];
		if (need < 1.5) {
			const due = dueness(m);
			if (due >= TOP_UP_DUE)
				extras.push({ muscle: m, sets: 2, readiness: r, need, reason: `on target this week, ${Math.round(r * 100)}% recovered: a light top-up`, due, score: 0 });
			continue;
		}
		// One session's share of the week; a bit more when well behind, never above the cap.
		const share = (target * intervalDays(m, s)) / 7;
		let sets = clamp(Math.round(Math.min(need, need > share * 1.5 ? share + 1 : share)), 2, SESSION_CAP[tier]);
		if (sore === 1) sets = Math.max(2, sets - 2);
		sets = Math.max(2, Math.round(sets * Math.min(1, energyMult)));
		const due = dueness(m);
		const reason =
			sore === 1
				? `a bit sore, so ${sets} sets`
				: `${round1(vol[m])} of ${target} sets this week, ${Math.round(r * 100)}% recovered`;
		candidates.push({ muscle: m, sets, readiness: r, need, reason, due, score: (need / target) * prio[tier] * r * Math.min(2, due) });
	}
	// Due muscles, plus neighbours nearly due (so legs, back or arms train together).
	const dueGroups = new Set(candidates.filter((c) => c.due >= 1).map((c) => MUSCLE_GROUP[c.muscle]));
	const rows = candidates.filter((c) => c.due >= 1 || (c.due >= PULL_FORWARD && dueGroups.has(MUSCLE_GROUP[c.muscle])));
	rows.sort((a, b) => b.score - a.score);
	// Never an empty day: if little is due, bring forward what is closest to due.
	const rest = [...candidates.filter((c) => !rows.includes(c) && c.due >= TOP_UP_DUE), ...extras].sort((a, b) => b.due - a.due);
	while (rows.reduce((n, r) => n + r.sets, 0) < MIN_DAY_SETS && rest.length) rows.push(rest.shift()!);
	return rows.map(({ score: _s, due: _d, ...r }) => r);
}

/** When a muscle that isn't due today comes round next, in words ("tomorrow", "in 2 days"). */
export function nextDue(m: Muscle, s: CoachSettings, sinceH: Partial<Record<Muscle, number>>): string | null {
	const h = sinceH[m];
	if (h == null) return null;
	const left = dueAfterH(m, s) - h;
	if (left <= 0) return null;
	const d = Math.max(1, Math.round(left / 24));
	return d === 1 ? 'tomorrow' : `in ${d} days`;
}

// ---------- prescriptions ----------

export type History = { at: Date; sets: { reps: number; weightKg: number; rir?: number | null }[] }[];

export type Prescription = {
	exercise: string;
	sets: number;
	repLow: number;
	repHigh: number;
	targetReps: number;
	rir: [number, number];
	weightLb: number | null; // null = no history: find a working weight
	restSec: number;
	kind: 'up' | 'hold' | 'down' | 'new';
	reason: string;
	warmups: { weightLb: number; reps: number }[];
};

type Ctx = {
	category: string;
	tier: Tier;
	energy: number | null;
	sore: 0 | 1 | 2;
	/** Recent sets of every exercise: a lift with no history gets a weight estimated from them. */
	sets?: LoggedSet[];
	bodyweightKg?: number | null;
};

/**
 * A starting weight for a lift never done before, from the lifts that have been. Each logged
 * lift implies a "bench 1-rep max" (its estimated max ÷ its STRENGTH ratio); the closest
 * relatives (same muscle, then same movement) count most. With no lifts at all, bodyweight
 * stands in (bench ≈ 0.75 × bodyweight, conservative). Aimed 10% light, rounded down to the
 * equipment — the first set's reps correct it from there.
 */
export function estimateStart(
	name: string,
	category: string,
	reps: number,
	rir: number,
	sets: LoggedSet[],
	bodyweightKg?: number | null
): { lb: number; from: string } | null {
	const ratio = STRENGTH[name];
	const p = profileFor(name);
	if (ratio == null || p.noLoad) return null;
	const best = new Map<string, number>();
	for (const s of sets) {
		if (s.isWarmup || s.weightKg <= 0 || s.exercise === name || STRENGTH[s.exercise] == null) continue;
		const e = e1rmRir(s.weightKg, s.reps, s.rir);
		if (e > (best.get(s.exercise) ?? 0)) best.set(s.exercise, e);
	}
	const m = primaryMuscle(p);
	const rows = [...best].map(([ex, e]) => {
		const q = profileFor(ex);
		const qm = primaryMuscle(q);
		const w = qm === m ? 4 : MUSCLE_GROUP[qm] === MUSCLE_GROUP[m] ? 3 : q.pattern === p.pattern ? 2 : q.compound === p.compound ? 1 : 0.5;
		return { ex, index: e / STRENGTH[ex], w };
	});
	let index: number;
	let from: string;
	if (rows.length) {
		// Weighted median, so one odd lift doesn't swing it.
		rows.sort((a, b) => a.index - b.index);
		const half = rows.reduce((n, r) => n + r.w, 0) / 2;
		let acc = 0;
		index = rows.find((r) => (acc += r.w) >= half)!.index;
		// Name the lift it came from only when one relative clearly leads.
		const top = Math.max(...rows.map((r) => r.w));
		const lead = rows.filter((r) => r.w === top);
		from = lead.length === 1 && top >= 3 ? lead[0].ex : 'other lifts';
	} else if (bodyweightKg) {
		index = bodyweightKg * 0.75;
		from = 'bodyweight';
	} else return null;
	const kg = (index * ratio * 0.9) / (1 + (reps + rir) / 30);
	const lb = kg / LB;
	const down = nextLb(category, lb + 1e-6, -1);
	const lowest = nextLb(category, 0, 1);
	const out = down > 0 ? down : lowest;
	return out > 0 ? { lb: out, from } : null;
}

/** Free weights and Smith load heavier compounds than cables and machines do. */
const FREE = (category: string) => ['barbell', 'smith machine', 'dumbbell', 'kettlebell'].includes(category);

export function repRange(p: ExerciseProfile, tier: Tier, category = 'barbell'): [number, number] {
	if (p.repsOverride) return p.repsOverride;
	const m = primaryMuscle(p);
	if (tier === 'athletic') return p.compound ? [5, 8] : [8, 12]; // strength without the soreness
	if (['sideDelts', 'rearDelts', 'calves', 'abs', 'obliques'].includes(m)) return [12, 20];
	if (!p.compound) return [10, 15];
	return FREE(category) ? [6, 10] : [8, 12];
}

/** Reps in reserve: compounds 1–2 (legs 2–3, kept fresh for running), isolations 0–1. */
export function rirTarget(p: ExerciseProfile, tier: Tier): [number, number] {
	if (tier === 'athletic') return [2, 3];
	return p.compound ? [1, 2] : [0, 1];
}

/**
 * Rest (Schoenfeld 2016; Singer 2024 — gains level off past ~90 s for most work): free-weight
 * compounds 2.5 min, cable/machine compounds 2, isolations 90 s, abs and calves 60 s.
 */
export function restFor(p: ExerciseProfile, category = 'barbell'): number {
	const m = primaryMuscle(p);
	if (p.pattern === 'power') return 90;
	if (p.compound) return FREE(category) ? 150 : 120;
	if (['abs', 'obliques', 'calves'].includes(m)) return 60;
	return 90;
}

/**
 * One ladder step up from `lb`. A jump over 10% is refused (progress reps instead) until reps
 * have run 3+ past the top of the range — light cables (15 → 17.5 lb is +17%) would never move
 * otherwise. Null when the equipment has nothing heavier (dumbbells max at 52.5 lb).
 */
function stepUp(category: string, lb: number, repsPastTop = 0): number | null {
	const up = nextLb(category, lb, 1);
	if (!(up > lb)) return null;
	return lb === 0 || (up - lb) / lb <= 0.1 + 1e-9 || repsPastTop >= 3 ? up : null;
}

/**
 * Double progression: same weight until every working set hits the top of the range,
 * then one equipment step up and back to the bottom. Two sessions in a row under the bottom
 * drop one step. Readiness (energy, soreness) can block an increase but never forces a drop.
 */
export function prescribe(name: string, muscle: string, sets: number, hist: History, ctx: Ctx): Prescription {
	const p = profileFor(name, muscle);
	const [lo, hi] = repRange(p, ctx.tier, ctx.category);
	const rir = rirTarget(p, ctx.tier);
	const restSec = restFor(p, ctx.category);
	const base = { exercise: name, sets, repLow: lo, repHigh: hi, rir, restSec, warmups: [] as Prescription['warmups'] };
	const last = hist.at(-1);
	if (!last || !last.sets.length) {
		if (p.noLoad)
			return { ...base, targetReps: lo + 2, weightLb: 0, kind: 'new', reason: `New exercise: aim for ${lo + 2}, stopping ${rir[1]} short of failure.` };
		const est = estimateStart(name, ctx.category, lo + 2, rir[1], ctx.sets ?? [], ctx.bodyweightKg);
		if (est)
			return {
				...base,
				targetReps: lo + 2,
				weightLb: est.lb,
				kind: 'new',
				reason: `New exercise, estimated from your ${est.from === 'bodyweight' ? 'bodyweight' : est.from}: ${est.lb} lb for ${lo + 2}. Adjust after the first set if it's off.`
			};
		return { ...base, targetReps: lo + 2, weightLb: null, kind: 'new', reason: `New exercise: find a weight you can do for ${lo + 2} with ${rir[1]} left.` };
	}

	const lastLb = roundLb(Math.max(...last.sets.map((x) => x.weightKg)) / LB);
	const atTop = last.sets.filter((x) => roundLb(x.weightKg / LB) === lastLb);
	const minReps = Math.min(...atTop.map((x) => x.reps));
	const hold = (ctx.energy != null && ctx.energy <= 2) || ctx.sore > 0;
	const prevMissed = (() => {
		const prev = hist.at(-2);
		if (!prev) return false;
		const w = Math.max(...prev.sets.map((x) => x.weightKg));
		return Math.abs(w / LB - lastLb) < 0.1 && Math.min(...prev.sets.map((x) => x.reps)) < lo;
	})();

	let weightLb = lastLb;
	let target = clamp(minReps + 1, lo, hi);
	let kind: Prescription['kind'] = 'hold';
	let reason: string;

	if (p.noLoad && lastLb === 0) {
		target = clamp(minReps + 1, lo, hi + 5);
		kind = minReps >= hi ? 'up' : 'hold';
		reason = `Bodyweight: aim for ${target} on every set (${minReps} last time).`;
	} else if (minReps >= hi) {
		const up = stepUp(ctx.category, lastLb, minReps - hi);
		if (hold) {
			target = hi;
			reason = `Topped out at ${lastLb} lb, but ${ctx.sore ? 'it is a bit sore' : 'energy is low'}: same weight today.`;
		} else if (up) {
			weightLb = up;
			// Reps expected at the new weight from last time's estimated max, inside the range.
			target = clamp(repsAt(e1rmRir(lastLb * LB, minReps, null), up * LB, rir[1]), lo, hi);
			kind = 'up';
			reason = `Hit ${minReps}+ on every set at ${lastLb} lb: up to ${up} lb.`;
		} else {
			// Next step too big for now, or nothing heavier (dumbbells max at 52.5): add reps.
			target = Math.min(minReps + 1, hi + 5);
			kind = 'up';
			const maxed = !(nextLb(ctx.category, lastLb, 1) > lastLb);
			reason = maxed
				? `${lastLb} lb is the heaviest setting: add reps (aim for ${target}), then slow the lowering to 3 s.`
				: `The next weight is a big jump from ${lastLb} lb, so add reps first: aim for ${target}.`;
		}
	} else if (minReps < lo && prevMissed) {
		weightLb = nextLb(ctx.category, lastLb, -1) || lastLb;
		target = clamp(lo + 2, lo, hi);
		kind = 'down';
		reason = `Under ${lo} reps two sessions running at ${lastLb} lb: down to ${weightLb} lb to rebuild.`;
	} else if (minReps < lo) {
		target = lo;
		reason = `Got ${minReps} at ${lastLb} lb last time: same weight, aim for ${lo}.`;
	} else {
		reason = `${lastLb} lb × ${minReps} last time: same weight, aim for ${target}.`;
	}

	return { ...base, targetReps: target, weightLb, kind, reason, warmups: [] };
}

/** Build-up sets for the session's first heavy compound (≥ 40 lb): ~50% × 8, ~75% × 4. */
export function warmupsFor(category: string, weightLb: number): Prescription['warmups'] {
	if (weightLb < 40) return [];
	const snap = (x: number) => {
		const down = nextLb(category, x + 1e-6, -1);
		const up = nextLb(category, down, 1);
		return x - down <= up - x ? down : up;
	};
	return [
		{ weightLb: snap(weightLb * 0.5), reps: 8 },
		{ weightLb: snap(weightLb * 0.75), reps: 4 }
	];
}

// ---------- during the session ----------

/** Reps you can do at `weightKg` given an estimated max, leaving `rir` in the tank (Epley). */
export function repsAt(e1rmKg: number, weightKg: number, rir = 0): number {
	return Math.max(0, Math.round(30 * (e1rmKg / weightKg - 1) - rir));
}

/** e1RM counting reps in reserve (a set of 8 with 2 left ≈ a 10-rep max). Taps are noisy, so ×0.5. */
export function e1rmRir(weightKg: number, reps: number, rir?: number | null) {
	const r = reps + (rir != null ? Math.min(rir, 4) * 0.5 : 1);
	return weightKg * (1 + r / 30);
}

/**
 * After a set: what the next set should be. 2+ reps over the top → up a step; 2+ under the
 * bottom → down a step. Rest stretches when reps fell more than 20% from the set before.
 */
export function afterSet(
	rx: Pick<Prescription, 'repLow' | 'repHigh' | 'restSec' | 'targetReps'>,
	category: string,
	done: { reps: number; weightLb: number }[]
): { weightLb: number; targetReps: number; restSec: number; note: string | null } {
	const last = done.at(-1)!;
	const prev = done.at(-2);
	let weightLb = last.weightLb;
	let targetReps = rx.targetReps;
	let note: string | null = null;
	if (last.reps >= rx.repHigh + 2) {
		const up = stepUp(category, last.weightLb);
		if (up) {
			weightLb = up;
			targetReps = rx.repLow + 1;
			note = `Got ${last.reps}, more than planned: up to ${up} lb.`;
		}
	} else if (last.reps <= rx.repLow - 2 && last.weightLb > 0) {
		const down = nextLb(category, last.weightLb, -1);
		if (down > 0) {
			weightLb = down;
			targetReps = rx.repLow;
			note = `Got ${last.reps}, under the range: down to ${down} lb.`;
		}
	}
	let restSec = rx.restSec;
	if (prev && prev.weightLb === last.weightLb && prev.reps > 0) {
		const drop = (prev.reps - last.reps) / prev.reps;
		if (drop > 0.35) restSec += 60;
		else if (drop > 0.2) restSec += 30;
		if (drop > 0.2 && !note) note = `Reps fell ${prev.reps} → ${last.reps}: longer rest to recover.`;
	}
	return { weightLb, targetReps, restSec, note };
}

// ---------- learning ----------

/**
 * Nudge a muscle's recovery speed from how a session's first working set went vs the
 * prediction. Beat it → recovers faster than assumed (τ down); missed → slower (τ up).
 * Clamped to 16–60 h; ~10% per session, so a few sessions are needed to move it.
 */
export function learnTau(tauH: number, predictedReps: number, actualReps: number): number {
	const err = actualReps - predictedReps;
	if (Math.abs(err) < 1) return tauH;
	return clamp(tauH * (err > 0 ? 0.92 : 1.08), 16, 60);
}

// ---------- session time ----------

/** Minutes for a set of prescriptions: work + rest per set, warm-ups, ~1 min per exercise change. */
export function sessionMinutes(rx: (Prescription & { category: string; supersetWith?: boolean })[]): number {
	let sec = 0;
	for (const x of rx) {
		const work = estimateSetSec(x.category, x.targetReps);
		// In an antagonist superset, the partner's work happens during this one's rest.
		const rest = x.supersetWith ? Math.max(0, x.restSec - 45) : x.restSec;
		sec += x.sets * (work + rest) + 60 + x.warmups.length * 60;
	}
	return Math.round(sec / 60);
}

// ---------- helpers ----------

function zero(): Record<Muscle, number> {
	return Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
}
function entries<T>(o: Partial<Record<Muscle, T>>) {
	return Object.entries(o) as [Muscle, T][];
}
function clamp(x: number, lo: number, hi: number) {
	return Math.min(hi, Math.max(lo, x));
}
const round1 = (x: number) => Math.round(x * 10) / 10;
const roundLb = (x: number) => Math.round(x * 2) / 2;
