/**
 * Checks for the v2 API additions (auth cookie, settings, idempotent offline sync, late sets,
 * set edit/delete, custom exercises, history/PRs, calibration, motion traces, coach program).
 *   node scripts/v2-check.mjs <baseUrl> <apiToken> <dashboardPassword>
 * Expects a coach agent (real or scripts/fake-agent.mjs) at the server's AGENT_URL.
 */
const BASE = process.argv[2] || 'http://localhost:5173';
const TOKEN = process.argv[3] || '';
const PW = process.argv[4] || TOKEN;
const H = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };
let failed = 0;
const ok = (cond, msg) => {
	console.log(`${cond ? '✓' : '✗'} ${msg}`);
	if (!cond) failed++;
};
const api = async (method, path, body, headers = H) => {
	const r = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
	const text = await r.text();
	let d = null;
	try { d = JSON.parse(text); } catch { d = text; }
	return { s: r.status, d, r };
};

// --- auth
ok((await api('GET', '/api/exercises', null, {})).s === 401, 'api without token → 401');
ok((await api('GET', '/', null, {})).s === 303, 'dashboard without cookie → redirect to /login');
const bad = await fetch(BASE + '/login', { method: 'POST', body: new URLSearchParams({ password: 'nope' }), headers: { origin: BASE, accept: 'text/html' }, redirect: 'manual' });
ok(bad.status === 401 || bad.status === 400, `wrong password rejected (${bad.status})`);
const login = await fetch(BASE + '/login?next=/coach', { method: 'POST', body: new URLSearchParams({ password: PW }), headers: { origin: BASE, accept: 'text/html' }, redirect: 'manual' });
const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
ok(login.status === 303 && login.headers.get('location') === '/coach' && cookie.startsWith('smx_session='), 'login sets cookie, redirects to next');
ok((await api('GET', '/api/settings', null, { cookie })).s === 200, 'dashboard cookie works on /api (coach page fetches)');
for (const p of ['/', '/workouts', '/history', '/reports', '/coach', '/settings', '/exercises'])
	ok((await fetch(BASE + p, { headers: { cookie }, redirect: 'manual' })).status === 200, `page ${p} → 200 with cookie`);

// --- settings
let st = await api('GET', '/api/settings');
ok(st.d.units === 'lb' && st.d.voiceCount === true && st.d.restAlarmSnoozeSec === 60, 'settings default lb / voice on / 60s snooze');
ok((await api('PATCH', '/api/settings', { units: 'stone' })).s === 400, 'bad units → 400');
st = await api('PATCH', '/api/settings', { restAlarmSnoozeSec: 90 });
ok(st.d.restAlarmSnoozeSec === 90, 'patch snooze');
await api('PATCH', '/api/settings', { restAlarmSnoozeSec: 60 });

// --- idempotent offline session + sets
const ex = (await api('GET', '/api/exercises')).d;
const bench = ex.find((e) => e.name === 'Bench Press');
ok(ex.length >= 60, `library expanded to ${ex.length} exercises`);
const cid = crypto.randomUUID();
const startedAt = Date.now() - 45 * 60_000;
const s1 = await api('POST', '/api/sessions', { clientId: cid, startedAt, name: 'Offline test', source: 'watch' });
const s2 = await api('POST', '/api/sessions', { clientId: cid, startedAt, name: 'Offline test', source: 'watch' });
ok(s1.s === 201 && s2.s === 200 && s1.d.id === s2.d.id, 'same session clientId → same session (201 then 200)');
ok(Math.abs(new Date(s1.d.startedAt).getTime() - startedAt) < 1000, 'client startedAt honored');
const sid = s1.d.id;
const setBody = { clientId: crypto.randomUUID(), exerciseId: bench.id, setIndex: 0, reps: 5, weightKg: 100, rpe: null,
	repEvents: [0, 2100, 4300, 6600, 9100].map((o, i) => ({ repIndex: i, offsetMs: o })) };
const a1 = await api('POST', `/api/sessions/${sid}/sets`, setBody);
const a2 = await api('POST', `/api/sessions/${sid}/sets`, setBody);
ok(a1.s === 201 && a2.s === 200 && a1.d.id === a2.d.id, 'same set clientId → no duplicate');
ok((await api('POST', `/api/sessions/${sid}/sets`, { ...setBody, clientId: undefined, reps: 0 })).s === 400, '0 reps → 400');
const fin = await api('POST', `/api/sessions/${sid}/finish`, {});
ok(fin.d.totalVolumeKg === 500, `finish volume 500 kg (got ${fin.d.totalVolumeKg})`);
const late = await api('POST', `/api/sessions/${sid}/sets`, { ...setBody, clientId: crypto.randomUUID(), setIndex: 1 });
ok(late.s === 201, 'set arriving after finish accepted (late watch sync)');
let sess = await api('GET', `/api/sessions/${sid}`);
ok(sess.d.totalVolumeKg === 1000, `rollup recomputed after late set → 1000 (got ${sess.d.totalVolumeKg})`);

// --- edit / delete set
const pe = await api('PATCH', `/api/sessions/${sid}/sets/${late.d.id}`, { reps: 6 });
ok(pe.s === 200 && pe.d.reps === 6, 'PATCH set reps');
sess = await api('GET', `/api/sessions/${sid}`);
ok(sess.d.totalVolumeKg === 1100, `rollup after edit → 1100 (got ${sess.d.totalVolumeKg})`);
ok((await api('PATCH', `/api/sessions/${sid}/sets/${late.d.id}`, { reps: -1 })).s === 400, 'PATCH bad reps → 400');
ok((await api('DELETE', `/api/sessions/${sid}/sets/${late.d.id}`)).s === 204, 'DELETE set → 204');
ok((await api('DELETE', `/api/sessions/${sid}/sets/${late.d.id}`)).s === 404, 'DELETE again → 404');
sess = await api('GET', `/api/sessions/${sid}`);
ok(sess.d.totalVolumeKg === 500, `rollup after delete → 500 (got ${sess.d.totalVolumeKg})`);

// --- custom exercises + history
const nm = `Landmine Press ${Date.now()}`;
const c1 = await api('POST', '/api/exercises', { name: nm, muscle: 'Shoulders', category: 'barbell' });
ok(c1.s === 201 && c1.d.isCustom === true && c1.d.muscle === 'shoulders', 'create custom exercise');
ok((await api('POST', '/api/exercises', { name: nm, muscle: 'shoulders', category: 'barbell' })).s === 409, 'duplicate name → 409');
ok((await api('POST', '/api/exercises', { name: 'x', muscle: 'y', category: 'spaceship' })).s === 400, 'bad category → 400');
const hist = await api('GET', `/api/exercises/${bench.id}/history`);
ok(hist.s === 200 && hist.d.sets.length > 0 && hist.d.prs.repMax['5'] >= 100, 'exercise history + rep-max PRs');

// --- calibration
const cal = await api('PUT', `/api/calibration/${bench.id}`, { params: { thresholdFrac: 0.42, minIntervalMs: 900 }, samples: 3 });
ok(cal.s === 200 && cal.d.params.thresholdFrac === 0.42, 'PUT calibration');
const cals = await api('GET', '/api/calibration');
ok(cals.d.some((c) => c.exerciseId === bench.id && c.samples === 3), 'GET calibration lists it');
ok((await api('PUT', '/api/calibration/999999', { params: {}, samples: 0 })).s === 400, 'calibration unknown exercise → 400');

// --- motion trace: a 3-minute set ≈ 0.9 MB, over SvelteKit's 512 KB default → needs BODY_SIZE_LIMIT
const samples = Array.from({ length: 50 * 180 }, (_, i) => [i * 20, ...Array.from({ length: 9 }, () => +(Math.random() * 2 - 1).toFixed(5))]);
const mt = await api('POST', '/api/motion-traces', { exerciseId: bench.id, setClientId: setBody.clientId, sampleHz: 50, detectedReps: 4, actualReps: 5, samples });
ok(mt.s === 201 && mt.d.id > 0, `motion trace stored (${(JSON.stringify(samples).length / 1e6).toFixed(1)} MB)`);
const mts = await api('GET', `/api/motion-traces?exerciseId=${bench.id}`);
ok(mts.d.length >= 1 && mts.d[0].samples === undefined, 'motion trace list omits samples');

// --- coach: plan from profile + request, save as workouts, revise, progress, apply
const plan = await api('POST', '/api/coach/plan', {
	profile: { goal: 'strength', daysPerWeek: 2, sessionMin: 60, experience: 'intermediate', equipment: ['barbell'] },
	request: 'bigger bench, no lunges'
});
ok(plan.s === 200 && plan.d.plan.days.length === 2, `coach plan → ${plan.s} with ${plan.d?.plan?.days?.length} days`);
const allMapped = plan.d.plan?.days.flatMap((d) => d.exercises).every((x) => x.exerciseId);
ok(allMapped, 'every plan exercise mapped to a library id');
const prof = await api('GET', '/api/coach/profile');
ok(prof.d.profile.goal === 'strength' && prof.d.profile.daysPerWeek === 2, 'profile saved from plan request');
const prog = await api('POST', '/api/coach/program', { plan: plan.d.plan });
ok(prog.s === 201 && prog.d.workoutIds.length === 2, 'program saved as 2 workouts');
const w0 = await api('GET', `/api/workouts/${prog.d.workoutIds[0]}`);
ok(w0.s === 200 && w0.d.exercises.length > 0, `saved workout "${w0.d.name}" has exercises`);
const rev = await api('POST', '/api/coach/plan', { request: 'swap squats for leg press', revise: true });
ok(rev.s === 200 && rev.d.reply, 'revise active program → reply');
const pr = await api('POST', '/api/coach/progress', { workoutId: prog.d.workoutIds[0] });
ok(pr.s === 200 && Array.isArray(pr.d.adjustments), 'progress suggestions');
const ap = await api('POST', '/api/coach/progress/apply', { workoutId: prog.d.workoutIds[0], adjustments: pr.d.adjustments });
const w1 = await api('GET', `/api/workouts/${prog.d.workoutIds[0]}`);
ok(ap.d.changed > 0 && w1.d.exercises[0].targetWeightKg === pr.d.adjustments[0].suggestedWeightKg, 'apply writes targets into the workout');

// --- coach chat: replies are filled in the background → poll; save/apply mark their message
const settle = async (id) => {
	for (let i = 0; i < 40; i++) {
		const m = (await api('GET', '/api/coach/chat')).d.messages.find((x) => x.id === id);
		if (m && !m.pending) return m;
		await new Promise((r) => setTimeout(r, 250));
	}
	return null;
};
await api('DELETE', '/api/coach/chat');
const ch1 = await api('POST', '/api/coach/chat', { text: 'new program please' });
ok(ch1.s === 200 && ch1.d.messages[1].pending === true, 'chat: returns at once with a pending reply');
const cm = await settle(ch1.d.messages[1].id);
ok(cm?.plan, 'chat: reply fills in with a plan');
await api('POST', '/api/coach/program', { plan: cm.plan, messageId: cm.id });
let hist2 = await api('GET', '/api/coach/chat');
ok(hist2.d.messages.find((m) => m.id === cm.id)?.saved === true, 'chat: saving marks the plan message saved');
const ch2 = await api('POST', '/api/coach/chat', { action: 'weights' });
const wm = await settle(ch2.d.messages[1].id);
ok(wm?.progress && wm.progress.adjustments.length > 0, `chat: today's weights for ${wm?.progress?.workoutName}`);
await api('POST', '/api/coach/progress/apply', { workoutId: wm.progress.workoutId, messageId: wm.id, adjustments: wm.progress.adjustments.slice(0, 1) });
hist2 = await api('GET', '/api/coach/chat');
ok(hist2.d.messages.find((m) => m.id === wm.id)?.applied?.length === 1, 'chat: apply marks only the checked suggestion');
ok((await api('POST', '/api/coach/chat', { text: '  ' })).s === 400, 'chat: empty text → 400');
ok((await api('DELETE', '/api/coach/chat')).s === 204 && (await api('GET', '/api/coach/chat')).d.messages.length === 0, 'chat: clear');

// --- calories: measured (watch / heart rate) beat the estimate and survive later edits
{
	const s0 = (await api('POST', '/api/sessions', { name: 'kcal test' })).d;
	await api('POST', `/api/sessions/${s0.id}/sets`, { exerciseId: bench.id, reps: 5, weightKg: 100, startedAt: Date.now() - 30000, completedAt: Date.now() });
	ok((await api('POST', `/api/sessions/${s0.id}/finish`, { activeKcal: 300, kcalSource: 'fitbit' })).s === 400, 'kcal: unknown source → 400');
	ok((await api('POST', `/api/sessions/${s0.id}/finish`, { activeKcal: -5, kcalSource: 'apple_watch' })).s === 400, 'kcal: negative → 400');
	const f = await api('POST', `/api/sessions/${s0.id}/finish`, { activeKcal: 312.4, avgHr: 118, kcalSource: 'apple_watch', bodyweightKg: 84 });
	ok(f.s === 200 && f.d.estimatedKcal === 312 && f.d.kcalSource === 'apple_watch' && f.d.avgHr === 118, `kcal: watch number stored (${f.d.estimatedKcal}, ${f.d.kcalSource}, ${f.d.avgHr} bpm)`);
	await api('POST', `/api/sessions/${s0.id}/sets`, { exerciseId: bench.id, reps: 5, weightKg: 100, setIndex: 1 });
	let g = (await api('GET', `/api/sessions/${s0.id}`)).d;
	ok(g.estimatedKcal === 312 && g.totalVolumeKg === 1000, 'kcal: late set updates volume but keeps the watch calories');
	const again = await api('POST', `/api/sessions/${s0.id}/finish`, { activeKcal: 330, kcalSource: 'apple_watch' });
	ok(again.d.estimatedKcal === 330, 'kcal: repeat finish with new watch number updates calories');
	const e = (await api('POST', '/api/sessions', { name: 'estimate test' })).d;
	await api('POST', `/api/sessions/${e.id}/sets`, { exerciseId: bench.id, reps: 5, weightKg: 100 });
	const ef = (await api('POST', `/api/sessions/${e.id}/finish`, {})).d;
	ok(ef.kcalSource === 'estimate' && ef.avgHr === null, `kcal: no measurement → estimate (${ef.estimatedKcal} kcal)`);
	const ex = (await api('GET', `/api/export`)).d.sessions.find((x) => x.id === s0.id);
	ok(ex?.kcalSource === 'apple_watch' && ex?.avgHr === 118, 'kcal: export carries source + avg heart rate');
}

console.log(failed ? `\n${failed} CHECK(S) FAILED ✗` : '\nALL V2 CHECKS PASSED ✓');
process.exit(failed ? 1 : 0);
