// Run: node --experimental-strip-types --test src/lib/coach/engine.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	DAVID_TIERS,
	afterSet,
	chooseMuscles,
	learnTau,
	prescribe,
	readiness,
	weeklyVolume,
	type CoachSettings,
	type LoggedSet
} from './engine.ts';
import { buildDay, type LibraryExercise } from './build.ts';
import { PROFILES, profileFor } from './muscles.ts';

const LB = 0.45359237;
const NOW = new Date('2026-10-27T16:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const S: CoachSettings = { tiers: DAVID_TIERS, cutting: true };
const sets = (exercise: string, h: number, n: number, lb: number, reps: number, rir: number | null = 1, sessionId = 1): LoggedSet[] =>
	Array.from({ length: n }, () => ({ at: hoursAgo(h), exercise, reps, weightKg: lb * LB, rir, sessionId }));

test('every seeded exercise has a profile', async () => {
	const seed = await import('node:fs').then((fs) => fs.readFileSync(new URL('../db/seed.ts', import.meta.url), 'utf8'));
	const names = [...seed.matchAll(/\['([^']+)', '[a-z]+', '/g)].map((m) => m[1]);
	assert.ok(names.length >= 83);
	assert.deepEqual(names.filter((n) => !PROFILES[n]), []);
});

test('weekly volume counts helpers at half and ignores old sets', () => {
	const v = weeklyVolume([...sets('Smith Machine Incline Press', 24, 3, 135, 10), ...sets('Bicep Curl', 24 * 8, 3, 25, 12)], NOW);
	assert.equal(v.chest, 3);
	assert.equal(v.triceps, 1.5);
	assert.equal(v.frontDelts, 1.5);
	assert.equal(v.biceps, 0);
});

test('readiness: hammered yesterday is low, three days later is recovered', () => {
	const hard = sets('Leg Extension', 2, 6, 100, 12, 0);
	assert.ok(readiness(hard, [], NOW).quads < 0.2);
	const later = new Date(NOW.getTime() + 72 * 3600_000);
	assert.ok(readiness(hard, [], later).quads > 0.85);
});

test('a long run yesterday tires calves and quads but not chest', () => {
	const r = readiness([], [{ at: hoursAgo(18), kind: 'Run', minutes: 80, km: 16 }], NOW);
	assert.ok(r.calves < 0.55, `calves ${r.calves}`);
	assert.ok(r.quads < 0.8, `quads ${r.quads}`);
	assert.equal(r.chest, 1);
});

test('very sore muscles are skipped, a bit sore get fewer sets', () => {
	const vol = weeklyVolume([], NOW);
	const ready = readiness([], [], NOW);
	const fresh = chooseMuscles(vol, ready, { energy: 4, soreness: {}, minutes: 45 }, S);
	const sore = chooseMuscles(vol, ready, { energy: 4, soreness: { chest: 2, biceps: 1 }, minutes: 45 }, S);
	assert.ok(fresh.some((m) => m.muscle === 'chest'));
	assert.ok(!sore.some((m) => m.muscle === 'chest'));
	const b = (xs: typeof fresh) => xs.find((m) => m.muscle === 'biceps')!.sets;
	assert.ok(b(sore) < b(fresh));
});

test('a skipped day leaves more need, not a scheduled rest', () => {
	const vol = weeklyVolume(sets('Cable Lateral Raise', 24 * 5, 4, 15, 15), NOW);
	const ready = readiness([], [], NOW);
	const rows = chooseMuscles(vol, ready, { energy: 3, soreness: {}, minutes: 45 }, S);
	assert.ok(rows.find((m) => m.muscle === 'sideDelts'), 'side delts still wanted with 4 of 14 done');
});

const ctx = { category: 'smith machine', tier: 'grow' as const, energy: 4, sore: 0 as const };

test('double progression: top of the range on every set → one step up', () => {
	const rx = prescribe('Smith Machine Incline Press', 'chest', 3, [{ at: hoursAgo(72), sets: [{ reps: 10, weightKg: 135 * LB }, { reps: 10, weightKg: 135 * LB }] }], ctx);
	assert.equal(rx.kind, 'up');
	assert.equal(rx.weightLb, 140);
	assert.ok(rx.targetReps >= 6 && rx.targetReps <= 10);
});

test('low energy blocks the increase', () => {
	const rx = prescribe('Smith Machine Incline Press', 'chest', 3, [{ at: hoursAgo(72), sets: [{ reps: 10, weightKg: 135 * LB }] }], { ...ctx, energy: 2 });
	assert.equal(rx.weightLb, 135);
	assert.equal(rx.kind, 'hold');
});

test('two misses in a row drop one step', () => {
	const miss = (h: number) => ({ at: hoursAgo(h), sets: [{ reps: 4, weightKg: 140 * LB }] });
	const rx = prescribe('Smith Machine Incline Press', 'chest', 3, [miss(150), miss(72)], ctx);
	assert.equal(rx.kind, 'down');
	assert.equal(rx.weightLb, 135);
});

test('light cable: +17% jump waits until reps run 3 past the top', () => {
	const c = { ...ctx, category: 'cable' };
	const h = (reps: number) => [{ at: hoursAgo(72), sets: [{ reps, weightKg: 15 * LB }] }];
	assert.equal(prescribe('Cable Lateral Raise', 'shoulders', 3, h(20), c).weightLb, 15);
	assert.equal(prescribe('Cable Lateral Raise', 'shoulders', 3, h(23), c).weightLb, 17.5);
});

test('maxed dumbbells progress by reps', () => {
	const rx = prescribe('Incline Dumbbell Press', 'chest', 3, [{ at: hoursAgo(72), sets: [{ reps: 10, weightKg: 52.5 * LB }] }], { ...ctx, category: 'dumbbell' });
	assert.equal(rx.weightLb, 52.5);
	assert.equal(rx.targetReps, 11);
	assert.match(rx.reason, /heaviest/);
});

test('mid-session: beat the range by 2 → up; reps collapse → longer rest', () => {
	const rx = { repLow: 8, repHigh: 10, restSec: 150, targetReps: 10 };
	assert.equal(afterSet(rx, 'smith machine', [{ reps: 12, weightLb: 140 }]).weightLb, 145);
	const r = afterSet(rx, 'smith machine', [{ reps: 10, weightLb: 140 }, { reps: 7, weightLb: 140 }]);
	assert.equal(r.restSec, 180);
	assert.equal(r.weightLb, 140);
});

test('recovery speed learns from beating or missing predictions', () => {
	assert.ok(learnTau(30, 8, 10) < 30);
	assert.ok(learnTau(30, 10, 7) > 30);
	assert.equal(learnTau(30, 10, 10), 30);
});

const LIB: LibraryExercise[] = [
	['Smith Machine Incline Press', 'chest', 'smith machine'],
	['Cable Fly', 'chest', 'cable'],
	['Cable Lateral Raise', 'shoulders', 'cable'],
	['Face Pull', 'shoulders', 'cable'],
	['Cable Overhead Tricep Extension', 'triceps', 'cable'],
	['Tricep Pushdown', 'triceps', 'cable'],
	['Incline Dumbbell Curl', 'biceps', 'dumbbell'],
	['Cable Curl', 'biceps', 'cable'],
	['Lat Pulldown', 'back', 'cable'],
	['Seated Cable Row', 'back', 'cable'],
	['Goblet Squat', 'quads', 'dumbbell'],
	['Bulgarian Split Squat', 'quads', 'dumbbell'],
	['Dumbbell Step-Up', 'quads', 'dumbbell'],
	['Dumbbell Romanian Deadlift', 'hamstrings', 'dumbbell'],
	['Cable Leg Curl', 'hamstrings', 'cable'],
	['Smith Machine Calf Raise', 'calves', 'smith machine'],
	['Cable Crunch', 'core', 'cable'],
	['Pallof Press', 'core', 'cable'],
	['Hanging Leg Raise', 'core', 'bodyweight']
].map(([name, muscle, category]) => ({ name, muscle, category }));

test('build: the mockup day — legs and back worked recently, 45 minutes', () => {
	const history = [
		...sets('Goblet Squat', 20, 4, 50, 13, 2, 9),
		...sets('Dumbbell Romanian Deadlift', 20, 3, 50, 12, 2, 9),
		...sets('Lat Pulldown', 48, 3, 140, 10, 1, 8),
		...sets('Seated Cable Row', 48, 3, 130, 10, 1, 8),
		...sets('Smith Machine Incline Press', 96, 2, 135, 10, 1, 7)
	];
	const plan = buildDay({
		now: NOW,
		sets: history,
		activities: [{ at: hoursAgo(30), kind: 'Run', minutes: 30, km: 5 }],
		library: LIB,
		checkIn: { energy: 4, soreness: { quads: 2, hamstrings: 1 }, minutes: 45 },
		settings: S
	});
	console.log(`\n  ${plan.title} · ${plan.totalSets} sets · ${plan.minutes} min`);
	for (const x of plan.exercises)
		console.log(`  ${x.supersetGroup ? 'SS' + x.supersetGroup + ' ' : ''}${x.exercise}: ${x.sets} × ${x.repLow}-${x.repHigh} @ ${x.weightLb ?? '?'} lb, rest ${x.restSec}s — ${x.reason}`);
	console.log('  resting: ' + plan.resting.map((r) => `${r.muscle} (${r.why})`).join(', '));
	const names = plan.exercises.map((x) => x.exercise);
	assert.ok(plan.minutes <= 45, `${plan.minutes} min`);
	assert.ok(!plan.exercises.some((x) => x.forMuscle === 'quads'), 'very sore quads skipped');
	assert.equal(names[0], 'Smith Machine Incline Press', 'priority compound first');
	assert.equal(plan.exercises[0].weightLb, 140);
	assert.ok(plan.exercises[0].warmups.length === 2);
	assert.ok(plan.exercises.every((x) => x.sets >= 2));
	assert.ok(plan.resting.some((r) => r.muscle === 'quads' && r.why === 'very sore'));
});

test('build: 30 minutes fits, using supersets or fewer sets', () => {
	const plan = buildDay({ now: NOW, sets: [], activities: [], library: LIB, checkIn: { energy: 3, soreness: {}, minutes: 30 }, settings: S });
	assert.ok(plan.minutes <= 30, `${plan.minutes} min`);
	assert.ok(plan.exercises.length >= 3);
});

test('build: 2 hours available still caps at a useful length', () => {
	const plan = buildDay({ now: NOW, sets: [], activities: [], library: LIB, checkIn: { energy: 5, soreness: {}, minutes: 120 }, settings: S });
	assert.ok(plan.minutes <= 75, `${plan.minutes} min`);
});

test('runner: leg picks favour low-soreness exercises', () => {
	const plan = buildDay({ now: NOW, sets: [], activities: [], library: LIB, checkIn: { energy: 4, soreness: {}, minutes: 75 }, settings: S });
	const legs = plan.exercises.filter((x) => ['quads', 'hamstrings', 'glutes'].includes(x.forMuscle)).map((x) => x.exercise);
	assert.ok(!legs.includes('Bulgarian Split Squat'), legs.join(', '));
	for (const x of plan.exercises.filter((x) => x.forMuscle === 'quads')) assert.deepEqual(x.rir, [2, 3]);
	assert.ok(profileFor('Dumbbell Step-Up').legCost! < 1);
});

test('arms and side delts get isolations, chest gets a compound', () => {
	const lib = [...LIB, ...[['Upright Row', 'shoulders', 'barbell'], ['Close-Grip Bench Press', 'triceps', 'barbell']].map(([name, muscle, category]) => ({ name, muscle, category }))];
	const plan = buildDay({ now: NOW, sets: [], activities: [], library: lib, checkIn: { energy: 4, soreness: {}, minutes: 60 }, settings: S });
	const names = plan.exercises.map((x) => x.exercise);
	assert.ok(!names.includes('Upright Row') && !names.includes('Close-Grip Bench Press'), names.join(', '));
	assert.ok(profileFor(plan.exercises.find((x) => x.forMuscle === 'chest')!.exercise).compound);
});
