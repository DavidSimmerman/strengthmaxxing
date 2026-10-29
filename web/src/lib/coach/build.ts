/**
 * Turns today's muscle list into a full session: picks exercises, splits sets, prescribes
 * weight × reps, orders them and fits the time. This is the plan used when Claude is slow or
 * down, and the budget Claude's own pick is validated against.
 */
import { profileFor, primaryMuscle, LEG_MUSCLES, type Muscle } from './muscles.ts';
import {
	chooseMuscles,
	prescribe,
	readiness,
	sessionMinutes,
	warmupsFor,
	weeklyVolume,
	weeklyTarget as weeklyTargetOf,
	type Activity,
	type CheckIn,
	type CoachSettings,
	type History,
	type LoggedSet,
	type MuscleDay,
	type Prescription
} from './engine.ts';

export type LibraryExercise = { name: string; muscle: string; category: string };

export type PlannedExercise = Prescription & {
	category: string;
	forMuscle: Muscle;
	supersetGroup: number | null;
	supersetWith?: boolean;
};

export type DayPlan = {
	title: string;
	minutes: number;
	totalSets: number;
	muscles: MuscleDay[];
	resting: { muscle: Muscle; why: string }[];
	exercises: PlannedExercise[];
	week: { muscle: Muscle; done: number; today: number; target: number }[];
};

export type BuildInput = {
	now: Date;
	sets: LoggedSet[]; // last ~6 weeks of logged sets
	activities: Activity[];
	library: LibraryExercise[];
	dislikes?: string[];
	checkIn: CheckIn;
	settings: CoachSettings;
	/** Most minutes worth spending even when more is available. */
	maxUsefulMinutes?: number;
};

const COMPOUND_FIRST: Muscle[] = ['chest', 'lats', 'upperBack', 'frontDelts'];

const ANTAGONIST: Partial<Record<Muscle, Muscle>> = {
	biceps: 'triceps',
	triceps: 'biceps',
	chest: 'upperBack',
	upperBack: 'chest',
	sideDelts: 'rearDelts',
	rearDelts: 'sideDelts',
	lats: 'chest'
};

export function buildDay(input: BuildInput): DayPlan {
	const { now, sets, checkIn, settings } = input;
	const vol = weeklyVolume(sets, now);
	const ready = readiness(sets, input.activities, now, settings.tauH);
	const muscles = chooseMuscles(vol, ready, checkIn, settings);
	const history = historyByExercise(sets);
	const recent = recentlyUsed(sets, now);
	const disliked = new Set((input.dislikes ?? []).map(norm));

	const budget = Math.min(checkIn.minutes, input.maxUsefulMinutes ?? 75);
	const tight = budget <= 45;
	const remaining = new Map<Muscle, number>(muscles.map((m) => [m.muscle, m.sets]));
	let chosen: PlannedExercise[] = [];
	const used = new Set<string>();

	const fits = (xs: PlannedExercise[]) => finalize(xs.map((x) => ({ ...x })), settings, tight) <= budget;
	const credit = (x: PlannedExercise, sets: number) => {
		for (const [m, c] of Object.entries(profileFor(x.exercise).credits) as [Muscle, number][])
			if (remaining.has(m)) remaining.set(m, (remaining.get(m) ?? 0) - c * sets);
	};
	const add = (md: MuscleDay, nth: number, take: number) => {
		const pick = pickExercise(md.muscle, nth, input.library, used, disliked, recent, ready, checkIn, settings);
		if (!pick) return false;
		const sore = (checkIn.soreness[md.muscle] ?? 0) as 0 | 1 | 2;
		const rx = prescribe(pick.name, pick.muscle, take, history.get(pick.name) ?? [], {
			category: pick.category,
			tier: settings.tiers[md.muscle],
			energy: checkIn.energy,
			sore
		});
		const cand: PlannedExercise = { ...rx, category: pick.category, forMuscle: md.muscle, supersetGroup: null };
		for (let k = take; k >= 2; k--) {
			cand.sets = k;
			if (!fits([...chosen, cand])) continue;
			used.add(pick.name);
			chosen.push(cand);
			credit(cand, k);
			return true;
		}
		return false;
	};

	// Pass 1, in priority order: one exercise per muscle, up to 3 sets, so a short session
	// covers several muscles instead of piling everything on the first few.
	for (const md of muscles) {
		const left = remaining.get(md.muscle) ?? 0;
		if (left >= 1.5) add(md, 0, Math.min(3, Math.round(left)));
	}
	// Pass 2, if time is left: top each muscle up — a 4th/5th set first, then a second exercise
	// (different regions grow from different exercises, e.g. Maeo 2023).
	for (const md of muscles) {
		const own = chosen.find((x) => x.forMuscle === md.muscle);
		if (!own) continue;
		while ((remaining.get(md.muscle) ?? 0) >= 1 && own.sets < 4) {
			own.sets++;
			if (!fits(chosen)) {
				own.sets--;
				break;
			}
			credit(own, 1);
		}
		const left = remaining.get(md.muscle) ?? 0;
		if (left >= 1.5) add(md, 1, Math.min(4, Math.round(left)));
	}
	finalize(chosen, settings, tight);

	const todayCredit = new Map<Muscle, number>();
	for (const x of chosen)
		for (const [m, c] of Object.entries(profileFor(x.exercise).credits) as [Muscle, number][])
			todayCredit.set(m, (todayCredit.get(m) ?? 0) + c * x.sets);

	const resting = (Object.keys(settings.tiers) as Muscle[])
		.filter((m) => !muscles.some((d) => d.muscle === m))
		.map((m) => ({ muscle: m, why: restReason(m, vol[m], ready[m], checkIn, settings) }));

	return {
		title: titleFor(chosen),
		minutes: sessionMinutes(chosen),
		totalSets: chosen.reduce((s, x) => s + x.sets, 0),
		muscles,
		resting,
		exercises: chosen,
		week: (Object.keys(settings.tiers) as Muscle[]).map((m) => ({
			muscle: m,
			done: Math.round(vol[m] * 10) / 10,
			today: Math.round((todayCredit.get(m) ?? 0) * 10) / 10,
			target: Math.round(weeklyTargetOf(m, settings))
		}))
	};
}

function pickExercise(
	m: Muscle,
	nth: number,
	lib: LibraryExercise[],
	used: Set<string>,
	disliked: Set<string>,
	recent: Map<string, number>,
	ready: Record<Muscle, number>,
	checkIn: CheckIn,
	s: CoachSettings
): LibraryExercise | null {
	let best: { e: LibraryExercise; score: number } | null = null;
	for (const e of lib) {
		if (used.has(e.name) || disliked.has(norm(e.name))) continue;
		const p = profileFor(e.name, e.muscle);
		if (primaryMuscle(p) !== m) continue;
		// Don't load a helper muscle that is very sore or badly fatigued.
		const helpers = Object.entries(p.credits) as [Muscle, number][];
		if (helpers.some(([h, c]) => h !== m && c >= 0.5 && ((checkIn.soreness[h] ?? 0) === 2 || ready[h] < 0.35))) continue;
		let score = 0;
		// Consistency: keep doing what has been done lately, so progress is trackable
		// (Kassiano 2022) — the strongest preference.
		score += Math.min(3, recent.get(e.name) ?? 0) * 1.5;
		if (p.stretch) score += 0.75;
		// Chest, back and front delts lead with a compound; arms, side/rear delts and core grow
		// best from isolations (a close-grip bench is a chest lift that happens to hit triceps).
		if (nth === 0 && p.compound && COMPOUND_FIRST.includes(m) && s.tiers[m] !== 'athletic') score += 1;
		if (p.compound && !COMPOUND_FIRST.includes(m) && !LEG_MUSCLES.includes(m)) score -= 1;
		if (nth === 1 && !p.compound) score += 1;
		if (LEG_MUSCLES.includes(m)) score -= ((p.legCost ?? 1) - 1) * 3; // runner: low-soreness leg work
		if (p.noLoad && p.pattern !== 'core' && p.pattern !== 'power') score -= 0.5;
		if (!best || score > best.score) best = { e, score };
	}
	return best?.e ?? null;
}

/**
 * Orders the session (power first, then priority-muscle compounds, compounds, isolations,
 * core last — Nunes 2021), adds warm-ups to the first loaded compound, and on short sessions
 * pairs antagonist isolations into supersets. Mutates `xs`; returns its length in minutes.
 */
function finalize(xs: PlannedExercise[], s: CoachSettings, tight: boolean): number {
	const rank = (x: PlannedExercise) => {
		const p = profileFor(x.exercise);
		if (p.pattern === 'power') return 0;
		if (p.pattern === 'core') return 5;
		if (p.compound) return s.tiers[x.forMuscle] === 'grow' ? 1 : 2;
		return s.tiers[x.forMuscle] === 'grow' ? 3 : 4;
	};
	xs.sort((a, b) => rank(a) - rank(b));
	for (const x of xs) {
		x.warmups = [];
		x.supersetGroup = null;
		x.supersetWith = false;
	}
	const first = xs.find((x) => profileFor(x.exercise).compound && x.weightLb);
	if (first) first.warmups = warmupsFor(first.category, first.weightLb!);
	if (tight) {
		let group = 1;
		for (const a of xs) {
			if (a.supersetGroup || profileFor(a.exercise).compound) continue;
			const b = xs.find(
				(y) => y !== a && !y.supersetGroup && !profileFor(y.exercise).compound && ANTAGONIST[a.forMuscle] === y.forMuscle
			);
			if (!b) continue;
			a.supersetGroup = b.supersetGroup = group++;
			a.supersetWith = true;
			xs.splice(xs.indexOf(b), 1);
			xs.splice(xs.indexOf(a) + 1, 0, b); // partners sit together
		}
	}
	return sessionMinutes(xs);
}

function historyByExercise(sets: LoggedSet[]): Map<string, History> {
	const bySession = new Map<string, Map<string, History[number]>>();
	for (const s of [...sets].sort((a, b) => a.at.getTime() - b.at.getTime())) {
		if (s.isWarmup) continue;
		const key = String(s.sessionId ?? s.at.toISOString().slice(0, 10));
		const m = bySession.get(s.exercise) ?? new Map();
		const h = m.get(key) ?? { at: s.at, sets: [] };
		h.sets.push({ reps: s.reps, weightKg: s.weightKg, rir: s.rir });
		m.set(key, h);
		bySession.set(s.exercise, m);
	}
	return new Map([...bySession].map(([k, v]) => [k, [...v.values()]]));
}

/** Sessions per exercise in the last 6 weeks (the current block). */
function recentlyUsed(sets: LoggedSet[], now: Date) {
	const seen = new Map<string, Set<string>>();
	for (const s of sets) {
		if (now.getTime() - s.at.getTime() > 42 * 864e5) continue;
		const k = String(s.sessionId ?? s.at.toISOString().slice(0, 10));
		seen.set(s.exercise, (seen.get(s.exercise) ?? new Set()).add(k));
	}
	return new Map([...seen].map(([k, v]) => [k, v.size]));
}

function restReason(m: Muscle, vol: number, ready: number, c: CheckIn, s: CoachSettings) {
	if ((c.soreness[m] ?? 0) === 2) return 'very sore';
	if ((c.soreness[m] ?? 0) === 1 && s.tiers[m] === 'athletic') return 'a bit sore, saved for running';
	if (ready < 0.6) return `${Math.round(ready * 100)}% recovered`;
	if (vol >= weeklyTargetOf(m, s) - 1.5) return 'done for the week';
	return 'lower priority today';
}

const GROUP: Record<Muscle, string> = {
	chest: 'Chest',
	frontDelts: 'Shoulders',
	sideDelts: 'Shoulders',
	rearDelts: 'Shoulders',
	lats: 'Back',
	upperBack: 'Back',
	biceps: 'Arms',
	triceps: 'Arms',
	abs: 'Core',
	obliques: 'Core',
	quads: 'Legs',
	hamstrings: 'Legs',
	glutes: 'Legs',
	calves: 'Legs'
};

/** "Chest, Shoulders, Arms and Core" — body areas in session order. */
function titleFor(xs: PlannedExercise[]) {
	const seen = [...new Set(xs.map((x) => GROUP[x.forMuscle]))];
	if (seen.length <= 1) return seen[0] ?? 'Rest or mobility';
	return seen.slice(0, -1).join(', ') + ' and ' + seen.at(-1);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
