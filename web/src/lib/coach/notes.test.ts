// Run: node --experimental-strip-types --test src/lib/coach/notes.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fallbackText, findTrigger, type NoteInput } from './notes.ts';

const NOW = new Date('2026-10-29T17:00:00');
const ago = (days: number, h = 12) => new Date(new Date(NOW.getTime() - days * 864e5).setHours(h, 0, 0, 0));
const base: NoteInput = { now: NOW, bodyweightKg: 72, food: [], sessions: [], body: [], sleep: [], pr: null, recentKinds: [] };
const meals = (days: number[], proteinG: number) =>
	days.flatMap((d) => [8, 13, 19].map((h) => ({ at: ago(d, h), proteinG: proteinG / 3, calories: 600 })));

test('nothing to say → no note', () => assert.equal(findTrigger(base), null));

test('low protein on 3+ logged days', () => {
	const t = findTrigger({ ...base, food: meals([1, 2, 3, 4], 90) });
	assert.equal(t?.kind, 'protein');
	assert.equal(t?.facts.targetG, 115); // 1.6 g/kg × 72 kg
	assert.equal(t?.facts.avgProteinG, 90);
});

test('enough protein → no protein note', () => assert.equal(findTrigger({ ...base, food: meals([1, 2, 3, 4], 130) }), null));

test('unlogged days do not count as low protein', () => {
	assert.equal(findTrigger({ ...base, food: [...meals([1], 90), { at: ago(2, 12), proteinG: 10, calories: 200 }] }), null);
});

test('losing over 1% a week → deficit note, ahead of protein', () => {
	const body = [0, 2, 4, 6, 8, 10].map((d, k) => ({ at: ago(10 - d), weightKg: 74 - k * 0.4 }));
	const t = findTrigger({ ...base, body, food: meals([1, 2, 3], 80) });
	assert.equal(t?.kind, 'deficit');
	assert.ok((t!.facts.pctPerWeek as number) > 1);
});

test('two workouts after 4+ hours without food → fasted', () => {
	const sessions = [{ startedAt: ago(1, 13), endedAt: ago(1, 14) }, { startedAt: ago(0, 13), endedAt: ago(0, 14) }];
	const food = [{ at: ago(1, 7), proteinG: 30, calories: 500 }, { at: ago(0, 7), proteinG: 30, calories: 500 }];
	assert.equal(findTrigger({ ...base, sessions, food })?.kind, 'fasted');
	const fed = [...food, { at: ago(0, 12), proteinG: 20, calories: 300 }];
	assert.notEqual(findTrigger({ ...base, sessions, food: fed })?.kind, 'fasted');
});

test('short sleep two nights → sleep note', () => {
	const t = findTrigger({ ...base, sleep: [{ date: '2026-10-28', sleepMin: 350 }, { date: '2026-10-29', sleepMin: 340 }] });
	assert.equal(t?.kind, 'sleep');
	assert.deepEqual(t?.facts.hours, [5.8, 5.7]);
});

test('a PR → praise; a kind noted recently is skipped', () => {
	const pr = { exercise: 'Smith Machine Incline Press', beforeLb: 180, nowLb: 190 };
	assert.equal(findTrigger({ ...base, pr })?.kind, 'praise');
	assert.equal(findTrigger({ ...base, pr, recentKinds: ['praise'] }), null);
});

test('fallback wording has no unfilled values', () => {
	for (const t of [
		{ kind: 'protein', facts: { avgProteinG: 90, targetG: 115, loggedDays: 4 } },
		{ kind: 'praise', facts: { exercise: 'Bench', estMaxBeforeLb: 180, estMaxNowLb: 190 } },
		{ kind: 'sleep', facts: { hours: [5.8, 5.7] } }
	] as const) {
		const x = fallbackText(t as never);
		assert.ok(x.title && !/undefined|NaN/.test(x.body), x.body);
	}
});
