/**
 * End-to-end API smoke test. Start the dev server first (pnpm dev), then:
 *   node scripts/smoke.mjs [baseUrl] [apiToken]
 * Exercises the full flow: workout -> session -> sets(+repEvents) -> finish -> export -> healthkit.
 * Exits non-zero on any failure. This is the runnable check for the repo/API layer.
 */
const BASE = process.argv[2] || 'http://localhost:5173';
const TOKEN = process.argv[3] || process.env.API_TOKEN || '';
const H = { 'content-type': 'application/json', ...(TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}) };
let failed = 0;
const call = async (m, p, body) => {
	const r = await fetch(BASE + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined });
	let d;
	try { d = await r.json(); } catch { d = null; }
	return { s: r.status, d };
};
const ok = (cond, msg) => { console.log(cond ? `✓ ${msg}` : `✗ FAIL: ${msg}`); if (!cond) failed++; };

const ex = await call('GET', '/api/exercises');
ok(ex.s === 200 && Array.isArray(ex.d) && ex.d.length > 0, `exercises (${ex.d?.length})`);
const bench = ex.d.find((e) => e.name === 'Bench Press')?.id ?? ex.d[0].id;
const curl = ex.d.find((e) => e.name === 'Bicep Curl')?.id ?? ex.d[1].id;

const w = await call('POST', '/api/workouts', {
	name: 'Smoke Push',
	exercises: [
		{ exerciseId: bench, orderIndex: 0, targetSets: 3, targetReps: 8, targetWeightKg: 60, restSec: 150 },
		{ exerciseId: curl, orderIndex: 1, supersetGroup: 1, targetSets: 3, targetReps: 12, targetWeightKg: 15 }
	]
});
ok(w.s === 201 && w.d?.id, `create workout -> 201 id ${w.d?.id}`);

const wg = await call('GET', `/api/workouts/${w.d.id}`);
ok(wg.s === 200 && wg.d.exercises?.length === 2 && wg.d.exercises[1].supersetGroup === 1, `workout has 2 exercises + superset`);

const ses = await call('POST', '/api/sessions', { workoutId: w.d.id, source: 'watch', bodyweightKg: 82 });
ok(ses.s === 201 && ses.d?.id, `start session -> 201 id ${ses.d?.id}`);
const sid = ses.d.id;

const t0 = Date.now();
const set1 = await call('POST', `/api/sessions/${sid}/sets`, {
	exerciseId: bench, setIndex: 0, reps: 8, weightKg: 60, startedAt: t0, completedAt: t0 + 22000,
	repEvents: [0, 1800, 3700, 5800, 8200, 11000, 14200, 18000].map((o, i) => ({ repIndex: i, offsetMs: o }))
});
ok(set1.s === 201, `log set w/ rep events`);

const fin = await call('POST', `/api/sessions/${sid}/finish`, {});
ok(fin.s === 200 && fin.d.totalVolumeKg === 480 && fin.d.estimatedKcal >= 0, `finish -> volume ${fin.d.totalVolumeKg}kg, kcal ${fin.d.estimatedKcal}`);

const exp = await call('GET', `/api/sessions/${sid}/export`);
const bs = exp.d.sets?.find((x) => x.exercise === 'Bench Press');
ok(exp.s === 200 && bs?.reps === 8 && bs.e1rmKg > 0, `export set reps=${bs?.reps} e1rm=${bs?.e1rmKg}`);
ok(bs?.fatigue?.decayPct > 0, `fatigue decay detected (${bs?.fatigue?.decayPct}%)`);

const hk = await call('GET', `/api/sessions/${sid}/healthkit`);
ok(hk.s === 200 && hk.d.workoutActivityType === 'traditionalStrengthTraining', `healthkit payload`);

const rd = await call('PUT', '/api/readiness/2026-07-07', { sleepHours: 8, kcalBalance: -300, sorenessLevel: 1 });
ok(rd.s === 200 && typeof rd.d.score === 'number', `readiness upsert -> score ${rd.d.score}`);

console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL SMOKE CHECKS PASSED ✓');
process.exit(failed ? 1 : 0);
