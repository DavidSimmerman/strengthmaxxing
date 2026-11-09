/**
 * The coach plans today's workout. Claude gets the whole picture (what each muscle got in the
 * last week and when, every lift's recent sessions, runs, the check-in and today's time) and
 * plans ONE focused workout, assuming more workouts follow in the next days, plus a sketch of
 * the next few. The code then checks it: exercises exist and suit the equipment, at most three
 * body areas plus core, no muscle hit hard again too soon, it fits the time, and weights follow
 * the progression rules (never up after a miss). Problems go back for one retry; after that the
 * code's own plan (`draft`) stands.
 */
import * as repo from './repo';
import { callAgent, getProfile } from './coach';
import { feedActivities, healthFeed } from './healthfeed';
import {
	coachSettings,
	hasEquipment,
	historyOf,
	isPerSide,
	latestBodyweightKg,
	recentSets,
	type SessionPlan,
	type SessionPlanExercise
} from './today';
import {
	hoursSinceTrained,
	MAX_AREAS,
	prescribe,
	readiness,
	sessionMinutes,
	warmupsFor,
	weeklyTarget,
	weeklyVolume
} from '$lib/coach/engine';
import { isTimed, LEG_MUSCLES, MUSCLE_GROUP, MUSCLE_LABEL, MUSCLES, primaryMuscle, profileFor, type Muscle } from '$lib/coach/muscles';
import { nextLb } from '$lib/equipment';

const LB = 0.45359237;
const TZ = 'America/New_York';
const day = (d: Date) => d.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
const r1 = (x: number) => Math.round(x * 10) / 10;

type DayItem = { name?: unknown; sets?: unknown; repLow?: unknown; repHigh?: unknown; targetReps?: unknown; weightLb?: unknown; reason?: unknown };

/** What the coach needs to know, in plain terms. Built fresh for every call. */
async function brief(draft: SessionPlan, now: Date) {
	const profile = getProfile();
	const settings = coachSettings();
	const sets = recentSets(now);
	const activities = feedActivities(await healthFeed(14));
	const vol = weeklyVolume(sets, now);
	const ready = readiness(sets, activities, now, settings.tauH);
	const since = hoursSinceTrained(sets, now);
	const favorites = new Set(profile.favorites ?? []);
	const disliked = new Set((profile.dislikes ?? []).map((d) => d.toLowerCase()));
	const lib = repo
		.listExercises()
		.filter((e) => hasEquipment(e.name, e.category, profile.equipment ?? []) && !disliked.has(e.name.toLowerCase()));
	const bw = latestBodyweightKg();

	const muscles = MUSCLES.map((m) => ({
		muscle: m,
		label: MUSCLE_LABEL[m],
		area: MUSCLE_GROUP[m],
		priority: settings.tiers[m],
		weeklyTarget: weeklyTarget(m, settings),
		last7Days: r1(vol[m]),
		lastHardSessionHoursAgo: since[m] != null ? Math.round(since[m]!) : null,
		recoveredPct: Math.round(ready[m] * 100),
		sorenessToday: ['fresh', 'a bit sore', 'very sore'][draft.checkIn.soreness[m] ?? 0]
	}));

	// Recent workouts, newest first: what was trained and how it went.
	const bySession = new Map<string, { at: Date; lines: Map<string, string[]> }>();
	for (const s of sets) {
		if (s.isWarmup) continue;
		const k = String(s.sessionId ?? s.at.toISOString().slice(0, 10));
		const x = bySession.get(k) ?? { at: s.at, lines: new Map() };
		const w = Math.round((s.weightKg / LB) * 2) / 2;
		x.lines.set(s.exercise, [...(x.lines.get(s.exercise) ?? []), `${s.reps}${isTimed(s.exercise) ? 's' : ''}${w ? `@${w}` : ''}`]);
		bySession.set(k, x);
	}
	const recentWorkouts = [...bySession.values()]
		.sort((a, b) => b.at.getTime() - a.at.getTime())
		.slice(0, 12)
		.map((x) => ({
			when: day(x.at),
			hoursAgo: Math.round((now.getTime() - x.at.getTime()) / 3600_000),
			exercises: [...x.lines].map(([n, l]) => `${n}: ${l.join(', ')}`)
		}));

	// The menu: every exercise he can do, with its history and the code's prescription for today.
	const menu = lib.map((e) => {
		const p = profileFor(e.name, e.muscle);
		const m = primaryMuscle(p);
		const hist = historyOf(sets, e.name);
		const rx = prescribe(e.name, e.muscle, 3, hist, {
			category: e.category,
			tier: settings.tiers[m],
			energy: draft.checkIn.energy,
			sore: (draft.checkIn.soreness[m] ?? 0) as 0 | 1 | 2,
			now,
			sets,
			bodyweightKg: bw
		});
		return {
			name: e.name,
			for: m,
			alsoWorks: Object.entries(p.credits)
				.filter(([k, c]) => k !== m && c >= 0.5)
				.map(([k]) => k),
			equipment: e.category,
			compound: p.compound,
			stretchPosition: !!p.stretch,
			oneSideAtATime: isPerSide(e),
			repsAreSeconds: isTimed(e.name),
			favorite: favorites.has(e.name),
			legSoreness: LEG_MUSCLES.includes(m) ? (p.legCost ?? 1) : undefined,
			last3: hist.slice(-3).map((h) => `${day(h.at)}: ${h.sets.map((s) => `${s.reps}${isTimed(e.name) ? 's' : ''}${s.weightKg ? `@${Math.round((s.weightKg / LB) * 2) / 2}` : ''}${s.rir != null ? ` (${s.rir} left)` : ''}`).join(', ')}`),
			today: { weightLb: rx.weightLb, repRange: [rx.repLow, rx.repHigh], targetReps: rx.targetReps, call: rx.kind, why: rx.reason }
		};
	});

	const runs = activities
		.filter((a) => now.getTime() - a.at.getTime() < 14 * 864e5)
		.map((a) => ({ what: a.kind, when: day(a.at), hoursAgo: Math.round((now.getTime() - a.at.getTime()) / 3600_000), minutes: a.minutes, miles: a.km ? r1(a.km * 0.621371) : null }));

	return {
		now: now.toLocaleString('en-US', { timeZone: TZ, weekday: 'long', hour: 'numeric', minute: '2-digit' }),
		checkIn: {
			energy: draft.checkIn.energy == null ? 'not given' : ['drained', 'low', 'ok', 'good', 'great'][draft.checkIn.energy - 1],
			minutes: draft.checkIn.minutes,
			note: draft.checkIn.note || null,
			skipToday: draft.checkIn.skip ?? []
		},
		goals: {
			summary:
				'Mostly upper body and core, for visible size and definition: core (a ripped core is a top goal), shoulders, ' +
				'biceps and triceps most; chest is already big but should still grow; back least but still trained. Legs: ' +
				'he runs often and plays basketball, so legs stay light and runner-friendly (strength without soreness), he ' +
				'does not care about big legs.',
			cutting: coachSettings().cutting,
			bodyweightLb: bw ? Math.round(bw / LB) : null,
			profileNotes: profile.notes ?? null,
			injuriesToAvoid: profile.avoid ?? null
		},
		muscles,
		recentWorkouts,
		runsAndSports: runs,
		menu,
		codeDraft: draft.exercises.map((x) => `${x.exercise} (${x.forMuscle}) ${x.sets}x${x.repLow}-${x.repHigh}`)
	};
}

/** Check Claude's day and turn it into a plan. Returns the problems to send back, if any. */
function check(raw: Record<string, unknown>, draft: SessionPlan, now: Date) {
	const problems: string[] = [];
	const profile = getProfile();
	const settings = coachSettings();
	const sets = recentSets(now);
	const since = hoursSinceTrained(sets, now);
	const disliked = new Set((profile.dislikes ?? []).map((d) => d.toLowerCase()));
	const lib = repo.listExercises();
	const byName = new Map(lib.map((e) => [e.name.toLowerCase(), e]));
	const bw = latestBodyweightKg();
	const items = (Array.isArray(raw.exercises) ? raw.exercises : []) as DayItem[];
	const out: SessionPlanExercise[] = [];
	const seen = new Set<string>();

	for (const it of items.slice(0, 12)) {
		const e = typeof it.name === 'string' ? byName.get(it.name.trim().toLowerCase()) : undefined;
		if (!e) {
			problems.push(`"${String(it.name)}" is not in the menu. Use exact menu names.`);
			continue;
		}
		if (!hasEquipment(e.name, e.category, profile.equipment ?? []) || disliked.has(e.name.toLowerCase())) {
			problems.push(`${e.name} is not available (equipment or a dislike).`);
			continue;
		}
		if (seen.has(e.name)) continue;
		seen.add(e.name);
		const p = profileFor(e.name, e.muscle);
		const m = primaryMuscle(p);
		const n = Math.max(1, Math.min(4, Math.round(Number(it.sets) || 3)));
		const rx = prescribe(e.name, e.muscle, n, historyOf(sets, e.name), {
			category: e.category,
			tier: settings.tiers[m],
			energy: draft.checkIn.energy,
			sore: (draft.checkIn.soreness[m] ?? 0) as 0 | 1 | 2,
			now,
			sets,
			bodyweightKg: bw
		});
		// Rep range: the coach may pick its own, within reason.
		const maxRep = isTimed(e.name) ? 120 : 30;
		let lo = Number(it.repLow);
		let hi = Number(it.repHigh);
		if (!(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 3 && hi > lo && hi <= maxRep && hi - lo <= (isTimed(e.name) ? 60 : 10))) {
			lo = rx.repLow;
			hi = rx.repHigh;
		}
		let target = Math.round(Number(it.targetReps));
		if (!(target >= lo && target <= hi)) target = Math.min(hi, Math.max(lo, rx.targetReps));
		// Weight: the code's progression call is the ceiling (never up after a miss); the coach
		// may go lower by up to ~15% with a reason.
		let lb = rx.weightLb;
		let kind = rx.kind;
		const asked = typeof it.weightLb === 'number' && it.weightLb >= 0 ? it.weightLb : null;
		if (asked != null && !p.noLoad) {
			const snapped = snap(e.category, asked);
			if (rx.weightLb == null) lb = snapped;
			else if (snapped < rx.weightLb - 1e-6 && snapped >= rx.weightLb * 0.85 - 1e-6) {
				lb = snapped;
				kind = rx.kind === 'up' ? 'hold' : 'down';
			}
		}
		const reason = typeof it.reason === 'string' && it.reason.trim() ? it.reason.trim().slice(0, 260) : rx.reason;
		out.push({
			...rx,
			sets: n,
			repLow: lo,
			repHigh: hi,
			targetReps: target,
			weightLb: lb,
			kind,
			reason,
			warmups: [],
			category: e.category,
			forMuscle: m,
			perSide: isPerSide(e),
			supersetGroup: null,
			exerciseId: e.id
		});
	}

	if (out.length < 2) problems.push('Plan at least two exercises.');
	const areas = [...new Set(out.map((x) => MUSCLE_GROUP[x.forMuscle]).filter((g) => g !== 'Core'))];
	if (areas.length > MAX_AREAS)
		problems.push(`Today covers ${areas.length} areas (${areas.join(', ')}). Keep it to ${MAX_AREAS} plus core; the rest goes to the next workouts.`);
	const perMuscle = new Map<Muscle, number>();
	for (const x of out) perMuscle.set(x.forMuscle, (perMuscle.get(x.forMuscle) ?? 0) + x.sets);
	for (const [m, n] of perMuscle) {
		const cap = settings.tiers[m] === 'grow' ? 8 : 6;
		if (n > cap) problems.push(`${MUSCLE_LABEL[m]} gets ${n} sets; at most ${cap} in one workout.`);
		const h = since[m];
		const legsAsked = LEG_MUSCLES.includes(m) && /\bleg/i.test(draft.checkIn.note ?? '');
		if (h != null && h < 40 && n >= 3 && !legsAsked)
			problems.push(`${MUSCLE_LABEL[m]} was trained hard ${Math.round(h)} hours ago; give it 48 hours (2 sets of light work at most).`);
	}
	const first = out.find((x) => profileFor(x.exercise).compound && (x.weightLb ?? 0) >= 40);
	if (first) first.warmups = warmupsFor(first.category, first.weightLb!);
	const minutes = sessionMinutes(out);
	if (minutes > draft.checkIn.minutes + 5)
		problems.push(`It takes about ${minutes} minutes; he has ${draft.checkIn.minutes}. Cut sets or exercises (the rest goes to later workouts).`);

	const lookAhead = (Array.isArray(raw.lookAhead) ? raw.lookAhead : [])
		.slice(0, 4)
		.map((l: { title?: unknown; why?: unknown }) => ({ title: String(l?.title ?? '').slice(0, 60), why: String(l?.why ?? '').slice(0, 200) }))
		.filter((l) => l.title);

	const credit = new Map<Muscle, number>();
	for (const x of out)
		for (const [mm, c] of Object.entries(profileFor(x.exercise).credits) as [Muscle, number][]) credit.set(mm, (credit.get(mm) ?? 0) + c * x.sets);

	const plan: SessionPlan = {
		...draft,
		title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim().slice(0, 60) : draft.title,
		exercises: out,
		minutes,
		totalSets: out.reduce((s, x) => s + x.sets, 0),
		muscles: [...perMuscle].map(([m, n]) => ({ muscle: m, sets: n, readiness: 1, need: 0, reason: '' })),
		resting: MUSCLES.filter((m) => !perMuscle.has(m) && (since[m] ?? 99) < 48).map((m) => ({ muscle: m, why: 'trained recently' })),
		week: draft.week.map((w) => ({ ...w, today: r1(credit.get(w.muscle) ?? 0) })),
		summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 500) : null,
		reviewed: true,
		lookAhead
	};
	return { plan, problems };
}

function snap(category: string, lb: number) {
	if (lb <= 0) return 0;
	const down = nextLb(category, lb + 1e-6, -1);
	const up = nextLb(category, down, 1);
	return !down || up - lb < lb - down ? up : down;
}

/**
 * Ask the coach to plan today. `draft` is the code's plan (used for the check-in, the week
 * numbers, and as the fallback). Throws when the agent can't be reached; returns the draft
 * when the coach's plan still breaks the rules after one retry.
 */
export async function coachPlanDay(draft: SessionPlan, now = new Date()): Promise<SessionPlan> {
	const facts = await brief(draft, now);
	let feedback: string[] = [];
	for (let attempt = 0; attempt < 2; attempt++) {
		const raw = await callAgent('/day', { ...facts, feedback });
		const { plan, problems } = check(raw, draft, now);
		if (!problems.length) return plan;
		console.warn('coach day plan problems:', problems);
		feedback = problems;
	}
	return { ...draft, summary: draft.summary ?? "The coach's plan didn't fit the rules, so this is the code's plan." };
}

export const _test = { check, brief };
