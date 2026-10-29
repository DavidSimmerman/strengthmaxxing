/**
 * Coach notes between workouts: at most one new note a day on the home screen. Code finds the
 * trigger from facts (healthmaxxing food / sleep / weight, logged sessions, PRs); Claude writes
 * the wording (POST /note), with a plain fallback if it can't.
 */
import { and, desc, eq, gte, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { coachNotes, sessions, sessionSets, exercises } from '$lib/db/schema';
import { e1rm } from '$lib/metrics';
import { isoDay } from '$lib/ui';
import * as repo from './repo';
import { callAgent } from './coach';
import { healthFeed } from './healthfeed';
import { fallbackText, findTrigger, type NoteInput } from '$lib/coach/notes';

const LB = 0.45359237;
const DAY = 864e5;

function noteInput(now: Date, feed: Awaited<ReturnType<typeof healthFeed>>): NoteInput {
	const since = new Date(now.getTime() - 14 * DAY);
	const finished = db
		.select({ id: sessions.id, startedAt: sessions.startedAt, endedAt: sessions.endedAt, bw: sessions.bodyweightKg })
		.from(sessions)
		.where(gte(sessions.startedAt, since))
		.orderBy(sessions.startedAt)
		.all()
		.filter((s) => s.endedAt);

	// Biggest estimated-max gain in a session finished in the last 2 days, vs everything before it.
	let pr: NoteInput['pr'] = null;
	const last = finished.filter((s) => now.getTime() - s.startedAt.getTime() <= 2 * DAY).at(-1);
	if (last) {
		const rows = db
			.select({ exerciseId: sessionSets.exerciseId, name: exercises.name, reps: sessionSets.reps, weightKg: sessionSets.weightKg, sessionId: sessionSets.sessionId, startedAt: sessions.startedAt })
			.from(sessionSets)
			.innerJoin(sessions, eq(sessionSets.sessionId, sessions.id))
			.innerJoin(exercises, eq(sessionSets.exerciseId, exercises.id))
			.where(eq(sessionSets.isWarmup, false))
			.all()
			.filter((r) => r.reps > 0 && r.reps <= 12);
		const now1 = new Map<number, { name: string; v: number }>();
		const before = new Map<number, number>();
		for (const r of rows) {
			const v = e1rm(r.weightKg, r.reps);
			if (r.sessionId === last.id) now1.set(r.exerciseId, { name: r.name, v: Math.max(v, now1.get(r.exerciseId)?.v ?? 0) });
			else if (r.startedAt < last.startedAt) before.set(r.exerciseId, Math.max(v, before.get(r.exerciseId) ?? 0));
		}
		for (const [id, x] of now1) {
			const b = before.get(id);
			if (b && x.v > b && (!pr || x.v / b > pr.nowLb / pr.beforeLb)) pr = { exercise: x.name, beforeLb: b / LB, nowLb: x.v / LB };
		}
	}

	const recentKinds = db
		.select({ kind: coachNotes.kind })
		.from(coachNotes)
		.where(gte(coachNotes.day, isoDay(new Date(now.getTime() - 3 * DAY))))
		.all()
		.map((r) => r.kind);
	const latestBody = feed?.body?.[0];
	return {
		now,
		bodyweightKg: latestBody?.weightKg ?? finished.findLast((s) => s.bw)?.bw ?? null,
		food: (feed?.food ?? []).map((f) => ({ at: new Date(f.loggedAt), proteinG: f.proteinG, calories: f.calories })),
		sessions: finished.map((s) => ({ startedAt: s.startedAt, endedAt: s.endedAt })),
		body: [...(feed?.body ?? [])].reverse().map((b) => ({ at: new Date(b.measuredAt), weightKg: b.weightKg })),
		sleep: Object.entries(feed?.daily ?? {})
			.filter(([, v]) => v.sleepMin != null)
			.map(([date, v]) => ({ date, sleepMin: v.sleepMin! })),
		pr,
		recentKinds
	};
}

let running: Promise<void> | null = null;

/** Write today's note if there isn't one yet and something is worth saying. Safe to call often. */
export function ensureTodayNote(now = new Date()): Promise<void> {
	if (running) return running;
	running = (async () => {
		const day = isoDay(now);
		if (db.select({ id: coachNotes.id }).from(coachNotes).where(eq(coachNotes.day, day)).get()) return;
		const t = findTrigger(noteInput(now, await healthFeed(14)));
		if (!t) return;
		let text = fallbackText(t);
		try {
			const r = await callAgent('/note', { kind: t.kind, facts: t.facts, units: repo.getSettings().units });
			if (typeof r.title === 'string' && typeof r.body === 'string' && r.body.trim())
				text = { title: r.title.trim().slice(0, 40), body: r.body.trim().slice(0, 400) };
		} catch {
			/* fallback wording */
		}
		// Re-check: another request may have written today's note while Claude was writing.
		if (db.select({ id: coachNotes.id }).from(coachNotes).where(eq(coachNotes.day, day)).get()) return;
		db.insert(coachNotes).values({ day, kind: t.kind, title: text.title, body: text.body, facts: t.facts }).run();
	})()
		.catch((e) => console.warn('coach note failed:', e instanceof Error ? e.message : e))
		.finally(() => (running = null));
	return running;
}

/** Undismissed notes from the last 3 days, newest first. */
export function currentNotes(now = new Date()) {
	return db
		.select({ id: coachNotes.id, kind: coachNotes.kind, title: coachNotes.title, body: coachNotes.body, createdAt: coachNotes.createdAt })
		.from(coachNotes)
		.where(and(isNull(coachNotes.dismissedAt), gte(coachNotes.day, isoDay(new Date(now.getTime() - 3 * DAY)))))
		.orderBy(desc(coachNotes.id))
		.limit(3)
		.all();
}

export const dismissNote = (id: number) =>
	db.update(coachNotes).set({ dismissedAt: new Date() }).where(eq(coachNotes.id, id)).run();
