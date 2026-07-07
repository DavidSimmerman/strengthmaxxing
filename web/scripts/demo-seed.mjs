/**
 * Populate a DB with realistic backdated demo history for screenshots / trying the app.
 * Talks to SQLite directly (backdated timestamps the API can't set). NOT used in prod.
 * Run: node --experimental-strip-types scripts/demo-seed.mjs   (from web/)
 */
import Database from 'better-sqlite3';
import { tonnage, estimateKcal, readinessScore } from '../src/lib/metrics.ts';

const db = new Database(process.env.DB_PATH || 'local.db');
const ex = Object.fromEntries(db.prepare('select name,id,met from exercises').all().map((e) => [e.name, e]));
const day = 86400;
const nowSec = Math.floor(new Date('2026-07-07T18:00:00Z').getTime() / 1000);

// wipe prior demo sessions/workouts (idempotent)
db.exec('delete from sessions; delete from workouts; delete from workout_exercises;');

const mkWorkout = (name, rows) => {
	const id = db.prepare('insert into workouts (name) values (?)').run(name).lastInsertRowid;
	rows.forEach((r, i) =>
		db
			.prepare(
				'insert into workout_exercises (workoutId,exerciseId,orderIndex,supersetGroup,targetSets,targetReps,targetWeightKg,restSec) values (?,?,?,?,?,?,?,?)'
			)
			.run(id, ex[r.n].id, i, r.ss ?? null, r.sets, r.reps, r.w, r.rest ?? 120)
	);
	return { id, rows };
};

const push = mkWorkout('Push A', [
	{ n: 'Bench Press', sets: 4, reps: 6, w: 80, rest: 180 },
	{ n: 'Overhead Press', sets: 3, reps: 8, w: 45, rest: 150 },
	{ n: 'Incline Bench Press', sets: 3, reps: 10, w: 55, rest: 120 },
	{ n: 'Lateral Raise', sets: 3, reps: 15, w: 12, ss: 1, rest: 60 },
	{ n: 'Tricep Pushdown', sets: 3, reps: 15, w: 25, ss: 1, rest: 60 }
]);
const pull = mkWorkout('Pull A', [
	{ n: 'Deadlift', sets: 3, reps: 5, w: 120, rest: 210 },
	{ n: 'Barbell Row', sets: 4, reps: 8, w: 70, rest: 150 },
	{ n: 'Lat Pulldown', sets: 3, reps: 12, w: 60, rest: 90 },
	{ n: 'Bicep Curl', sets: 3, reps: 12, w: 15, ss: 2, rest: 60 },
	{ n: 'Face Pull', sets: 3, reps: 15, w: 20, ss: 2, rest: 60 }
]);
const legs = mkWorkout('Legs', [
	{ n: 'Back Squat', sets: 4, reps: 6, w: 100, rest: 210 },
	{ n: 'Romanian Deadlift', sets: 3, reps: 10, w: 90, rest: 150 },
	{ n: 'Leg Press', sets: 3, reps: 12, w: 180, rest: 120 },
	{ n: 'Leg Curl', sets: 3, reps: 12, w: 45, rest: 90 },
	{ n: 'Calf Raise', sets: 4, reps: 15, w: 60, rest: 60 }
]);

const bw = 82;
const rotate = [push, pull, legs];
// 12 sessions across the last ~28 days (roughly Mon/Wed/Fri), progressive overload.
const schedule = [26, 24, 22, 19, 17, 15, 12, 10, 8, 5, 3, 1];

schedule.forEach((daysAgo, sIdx) => {
	const wk = rotate[sIdx % 3];
	const startSec = nowSec - daysAgo * day - 3600; // ~evening
	const cycle = Math.floor(sIdx / 3); // progression cycles
	const readyRaw = [88, 72, 61, 80, 55, 90, 76, 68, 84, 59, 79, 86][sIdx];
	const sleep = [8.1, 6.4, 5.6, 7.8, 5.2, 8.4, 7.1, 6.6, 8.0, 5.4, 7.4, 8.2][sIdx];
	const deficit = [-250, -600, -850, -300, -1000, -150, -450, -700, -200, -950, -400, -250][sIdx];
	const score = readinessScore({ sleepHours: sleep, kcalBalance: deficit, hrvMs: 55 + (readyRaw - 70) / 3, hrvBaselineMs: 58 });

	const sid = db
		.prepare(
			'insert into sessions (workoutId,name,source,startedAt,bodyweightKg,readinessScore) values (?,?,?,?,?,?)'
		)
		.run(wk.id, wk === push ? 'Push A' : wk === pull ? 'Pull A' : 'Legs', 'watch', startSec, bw, score).lastInsertRowid;

	let cursor = startSec;
	const allSets = [];
	const kcalSets = [];
	wk.rows.forEach((r) => {
		// progressive overload: small weight bumps each cycle, slight dip on low-readiness days
		const prog = wk === push && r.n === 'Bench Press' ? cycle * 2.5 : cycle * 2.0;
		const lowDay = score < 63 ? 0.94 : 1;
		const weight = Math.round((r.w + prog) * lowDay * 2) / 2;
		for (let set = 0; set < r.sets; set++) {
			const fatigued = set >= r.sets - 1; // last set drags
			const baseRepMs = 1600 + set * 120;
			const setStart = cursor + 8;
			const reps = r.reps - (fatigued && score < 65 ? 1 : 0);
			// rep-event offsets: gaps grow within the set, more so when fatigued/low-readiness
			let off = 0;
			const events = [];
			for (let k = 0; k < reps; k++) {
				const growth = 1 + (k / reps) * (fatigued ? 0.9 : 0.35) * (score < 65 ? 1.4 : 1);
				if (k > 0) off += Math.round(baseRepMs * growth);
				events.push({ repIndex: k, offsetMs: off, concentricMs: Math.round(700 * growth) });
			}
			const setDurSec = Math.max(10, Math.round(off / 1000) + 3);
			const completed = setStart + setDurSec;
			const setId = db
				.prepare(
					'insert into session_sets (sessionId,exerciseId,setIndex,supersetGroup,reps,weightKg,rpe,isWarmup,restSecActual,startedAt,completedAt) values (?,?,?,?,?,?,?,0,?,?,?)'
				)
				.run(sid, ex[r.n].id, set, r.ss ?? null, reps, weight, fatigued ? 9 : 7.5, r.rest, setStart, completed).lastInsertRowid;
			const ins = db.prepare('insert into rep_events (sessionSetId,repIndex,offsetMs,concentricMs) values (?,?,?,?)');
			events.forEach((e) => ins.run(setId, e.repIndex, e.offsetMs, e.concentricMs));
			allSets.push({ reps, weightKg: weight });
			kcalSets.push({ met: ex[r.n].met, activeMin: setDurSec / 60 });
			cursor = completed + r.rest;
		}
	});
	const endSec = cursor;
	const totalVol = tonnage(allSets);
	const totalMin = (endSec - startSec) / 60;
	const activeMin = kcalSets.reduce((s, x) => s + x.activeMin, 0);
	const kcal = estimateKcal(kcalSets, Math.max(0, totalMin - activeMin), bw);
	db.prepare('update sessions set endedAt=?, totalVolumeKg=?, estimatedKcal=? where id=?').run(endSec, totalVol, kcal, sid);

	// readiness row for that day
	const iso = new Date(startSec * 1000).toISOString().slice(0, 10);
	db.prepare(
		'insert into readiness (date,sleepHours,kcalBalance,proteinG,hrvMs,restingHr,score,updatedAt) values (?,?,?,?,?,?,?,?) on conflict(date) do update set score=excluded.score'
	).run(iso, sleep, deficit, 150 + sIdx, 55 + (readyRaw - 70) / 3, 52, score, startSec);
});

const n = db.prepare('select count(*) c from sessions').get().c;
console.log(`demo-seed: ${n} sessions, 3 templates, readiness rows created ✓`);
