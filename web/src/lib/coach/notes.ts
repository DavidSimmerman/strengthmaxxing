/**
 * Coach-note triggers: which short note (if any) is worth showing today, from facts the server
 * gathered. Pure, no DB — see $lib/server/notes for the gathering, wording and storage.
 */
import { isoDay } from '../ui.ts';

const LB = 0.45359237;
const DAY = 864e5;

export type NoteInput = {
	now: Date;
	bodyweightKg: number | null;
	food: { at: Date; proteinG: number; calories: number }[];
	sessions: { startedAt: Date; endedAt: Date | null }[]; // finished lifting sessions, newest last
	body: { at: Date; weightKg: number }[];
	sleep: { date: string; sleepMin: number }[];
	pr: { exercise: string; beforeLb: number; nowLb: number } | null; // best e1RM gain in the last 2 days
	recentKinds: string[]; // kinds already noted in the last 3 days
};
export type Trigger = { kind: 'deficit' | 'protein' | 'fasted' | 'sleep' | 'praise'; facts: Record<string, unknown> };

const r1 = (x: number) => Math.round(x * 10) / 10;

/** The most useful note for today, or null. Priority: deficit, protein, fasted, sleep, praise. */
export function findTrigger(i: NoteInput): Trigger | null {
	const skip = new Set(i.recentKinds);
	const out: Trigger[] = [];

	// Losing faster than ~1% of body weight a week risks muscle (Helms 2014 recommends 0.5–1%).
	const body = i.body.filter((b) => i.now.getTime() - b.at.getTime() <= 14 * DAY);
	if (body.length >= 5 && (body.at(-1)!.at.getTime() - body[0].at.getTime()) / DAY >= 7) {
		const xs = body.map((b) => b.at.getTime() / DAY);
		const ys = body.map((b) => b.weightKg);
		const mx = xs.reduce((a, b) => a + b) / xs.length;
		const my = ys.reduce((a, b) => a + b) / ys.length;
		const slope = xs.reduce((s, x, k) => s + (x - mx) * (ys[k] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
		const pct = (-slope * 7) / my;
		if (pct > 0.01) out.push({ kind: 'deficit', facts: { lbPerWeek: r1((-slope * 7) / LB), pctPerWeek: r1(pct * 100), weighIns: body.length } });
	}

	// Protein: ~1.6 g/kg/day is where gains level off (Morton 2018), more matters in a deficit.
	const byDay = new Map<string, { p: number; k: number }>();
	for (const f of i.food) {
		const d = isoDay(f.at);
		const v = byDay.get(d) ?? { p: 0, k: 0 };
		v.p += f.proteinG;
		v.k += f.calories;
		byDay.set(d, v);
	}
	if (i.bodyweightKg) {
		const target = Math.round(1.6 * i.bodyweightKg);
		const days = [1, 2, 3, 4, 5]
			.map((n) => byDay.get(isoDay(new Date(i.now.getTime() - n * DAY))))
			.filter((v): v is { p: number; k: number } => !!v && v.k >= 800); // a day that was actually logged
		const low = days.filter((d) => d.p < target).length;
		if (days.length >= 3 && low >= 3) {
			const avg = Math.round(days.reduce((s, d) => s + d.p, 0) / days.length);
			out.push({ kind: 'protein', facts: { avgProteinG: avg, targetG: target, lowDays: low, loggedDays: days.length, bodyweightLb: Math.round(i.bodyweightKg / LB) } });
		}
	}

	// Training fasted: the last two sessions (this week) started 4+ h after the last logged food,
	// on days that do have food logged (so a day that just wasn't logged doesn't count).
	const recent = i.sessions.filter((s) => i.now.getTime() - s.startedAt.getTime() <= 7 * DAY).slice(-2);
	if (recent.length === 2) {
		const gaps = recent.map((s) => {
			const day = isoDay(s.startedAt);
			if (!i.food.some((f) => isoDay(f.at) === day)) return null;
			const before = i.food.filter((f) => f.at <= s.startedAt && s.startedAt.getTime() - f.at.getTime() < DAY).at(-1);
			return before ? (s.startedAt.getTime() - before.at.getTime()) / 3600_000 : 24;
		});
		if (gaps.every((g) => g != null && g >= 4))
			out.push({ kind: 'fasted', facts: { hoursSinceFood: gaps.map((g) => Math.min(24, Math.round(g!))) } });
	}

	const nights = [...i.sleep].sort((a, b) => a.date.localeCompare(b.date)).slice(-2);
	if (nights.length === 2 && nights.every((n) => n.sleepMin < 390))
		out.push({ kind: 'sleep', facts: { hours: nights.map((n) => r1(n.sleepMin / 60)) } });

	if (i.pr && i.pr.nowLb > i.pr.beforeLb)
		out.push({ kind: 'praise', facts: { exercise: i.pr.exercise, estMaxBeforeLb: Math.round(i.pr.beforeLb), estMaxNowLb: Math.round(i.pr.nowLb), pctUp: r1((i.pr.nowLb / i.pr.beforeLb - 1) * 100) } });
	else {
		const week = i.sessions.filter((s) => i.now.getTime() - s.startedAt.getTime() <= 7 * DAY).length;
		if (week >= 4) out.push({ kind: 'praise', facts: { sessionsThisWeek: week } });
	}

	return out.find((t) => !skip.has(t.kind)) ?? null;
}

/** Plain wording when Claude isn't available. */
export function fallbackText(t: Trigger): { title: string; body: string } {
	const f = t.facts as Record<string, never>;
	switch (t.kind) {
		case 'deficit':
			return { title: 'Heads up', body: `You're losing about ${f.lbPerWeek} lb a week (${f.pctPerWeek}% of body weight). Faster than about 1% a week risks muscle; a slightly smaller deficit keeps your lifts climbing.` };
		case 'protein':
			return { title: 'Protein', body: `You've averaged ${f.avgProteinG} g of protein on your last ${f.loggedDays} logged days. Around ${f.targetG} g a day protects muscle while cutting.` };
		case 'fasted':
			return { title: 'Fuel up', body: `Your last two workouts started ${f.hoursSinceFood[0]}+ hours after you last ate. A snack an hour before usually means better sets.` };
		case 'sleep':
			return { title: 'Sleep', body: `Only ${f.hours[0]} and ${f.hours[1]} hours the last two nights. Recovery and strength both take a hit; aim for 7+ tonight.` };
		case 'praise':
			return f.exercise
				? { title: 'Nice work', body: `${f.exercise}: your estimated max went from ${f.estMaxBeforeLb} to ${f.estMaxNowLb} lb. That's real progress mid-cut.` }
				: { title: 'Nice work', body: `${f.sessionsThisWeek} workouts in the last 7 days. That consistency is what builds muscle.` };
	}
}

