/**
 * Talk to the coach mid-workout. The agent (POST /live) answers with a short reply and actions;
 * every action is validated here before it touches the session: swaps only to a same-muscle
 * exercise the lifter can do, weights snapped to the equipment, sets kept in range.
 */
import * as repo from './repo';
import { callAgent, getProfile, saveProfile, type SessionSuggestions } from './coach';
import { addInjury, hasEquipment, isMuscle, prescribeFor, type SessionPlan, type SessionPlanExercise } from './today';
import { primaryMuscle, profileFor, type Muscle } from '$lib/coach/muscles';
import { sessionMinutes, warmupsFor } from '$lib/coach/engine';
import { nextLb } from '$lib/equipment';

const LB = 0.45359237;

type Action =
	| { type: 'swap'; exercise: string; to: string }
	| { type: 'adjust'; exercise: string; weightLb?: number | null; reps?: number | null }
	| { type: 'sets'; exercise: string; sets: number }
	| { type: 'remove'; exercise: string }
	| { type: 'dislike'; exercise: string }
	| { type: 'injury'; muscles: string[]; note: string };

/** The nearest weight this equipment can be set to. */
function snapLb(category: string, lb: number) {
	if (lb <= 0) return 0;
	const down = nextLb(category, lb + 1e-6, -1);
	const up = nextLb(category, down, 1);
	return !down || up - lb < lb - down ? up : down;
}

export async function liveChat(sessionId: number, message: string) {
	const s = repo.getSession(sessionId);
	if (!s || s.endedAt) return null;
	const lib = repo.listExercises();
	const byId = new Map(lib.map((e) => [e.id, e]));
	const byName = new Map(lib.map((e) => [e.name, e]));
	const profile = getProfile();
	const plan = (s.plan as SessionPlan | null) ?? null;
	const sug: SessionSuggestions = (s.suggestions as SessionSuggestions | null) ?? { status: 'ready', at: new Date().toISOString() };
	const items: NonNullable<SessionSuggestions['items']> = { ...(sug.items ?? {}) };
	const removed = new Set(s.removedExerciseIds ?? []);

	// The session's exercises in order, as the workout screen shows them.
	const template = s.workoutId ? repo.getWorkout(s.workoutId) : undefined;
	const ids: number[] = [];
	const push = (id: number) => !removed.has(id) && !ids.includes(id) && byId.has(id) && ids.push(id);
	for (const x of plan?.exercises ?? []) push(x.exerciseId);
	for (const we of template?.exercises ?? []) push(we.exerciseId);
	for (const id of s.extraExerciseIds ?? []) push(id);
	for (const set of s.sets) push(set.exerciseId);

	const doneSets = (id: number) => s.sets.filter((x) => x.exerciseId === id && !x.isWarmup);
	const targetSets = (id: number) =>
		items[id]?.sets ??
		plan?.exercises.find((x) => x.exerciseId === id)?.sets ??
		template?.exercises.find((we) => we.exerciseId === id)?.targetSets ??
		3;
	const forMuscle = (id: number): Muscle =>
		plan?.exercises.find((x) => x.exerciseId === id)?.forMuscle ?? primaryMuscle(profileFor(byId.get(id)!.name, byId.get(id)!.muscle));

	const disliked = new Set((profile.dislikes ?? []).map((d) => d.toLowerCase()));
	const inSession = new Set(ids.map((id) => byId.get(id)!.name));
	const alternatives = Object.fromEntries(
		ids.map((id) => {
			const m = forMuscle(id);
			return [
				byId.get(id)!.name,
				lib
					.filter((e) => !inSession.has(e.name) && !disliked.has(e.name.toLowerCase()))
					.filter((e) => hasEquipment(e.name, e.category, profile.equipment ?? []))
					.filter((e) => primaryMuscle(profileFor(e.name, e.muscle)) === m)
					.map((e) => e.name)
			];
		})
	);

	const chat = [...(s.chat ?? [])];
	const r = await callAgent('/live', {
		message: message.slice(0, 1000),
		session: {
			name: s.name,
			checkIn: s.checkin,
			exercises: ids.map((id) => {
				const e = byId.get(id)!;
				const it = items[id];
				return {
					name: e.name,
					equipment: e.category,
					forMuscle: forMuscle(id),
					targetSets: targetSets(id),
					today: it ? { weightLb: Math.round((it.weightKg / LB) * 2) / 2, reps: it.reps } : null,
					done: doneSets(id).map((x) => `${x.reps}×${Math.round((x.weightKg / LB) * 2) / 2} lb`)
				};
			})
		},
		alternatives,
		profile: { avoid: profile.avoid, notes: profile.notes, dislikes: profile.dislikes },
		recentChat: chat.slice(-6).map((m) => ({ role: m.role, text: m.text }))
	});

	const reply = typeof r.reply === 'string' && r.reply.trim() ? r.reply.trim().slice(0, 800) : 'Done.';
	const actions = (Array.isArray(r.actions) ? r.actions : []) as Action[];
	const applied: string[] = [];
	let planOut = plan ? { ...plan, exercises: [...plan.exercises] } : null;
	const idOf = (name: unknown) => (typeof name === 'string' ? byName.get(name)?.id : undefined);

	for (const a of actions.slice(0, 6)) {
		if (a.type === 'swap') {
			const fromId = idOf(a.exercise);
			const to = typeof a.to === 'string' ? byName.get(a.to) : undefined;
			if (!fromId || !ids.includes(fromId) || !to || !alternatives[a.exercise]?.includes(to.name)) continue;
			const done = doneSets(fromId).length;
			const total = targetSets(fromId);
			if (done >= total) continue;
			const m = forMuscle(fromId);
			const rx = prescribeFor(to, m, total - done, s.checkin ?? { energy: null, soreness: {} });
			items[to.id] = { weightKg: (rx.weightLb ?? 0) * LB, reps: rx.targetReps, kind: rx.kind === 'new' ? 'hold' : rx.kind, reason: `Swapped in for ${a.exercise}.` };
			if (planOut) {
				const i = planOut.exercises.findIndex((x) => x.exerciseId === fromId);
				const entry: SessionPlanExercise = {
					...(planOut.exercises[i] ?? ({} as SessionPlanExercise)),
					...rx,
					exercise: to.name,
					exerciseId: to.id,
					category: to.category,
					forMuscle: m,
					sets: total - done,
					warmups: rx.weightLb && done === 0 && planOut.exercises[i]?.warmups.length ? warmupsFor(to.category, rx.weightLb) : [],
					reason: `Swapped in for ${a.exercise}.`
				};
				if (i < 0) planOut.exercises.push(entry);
				else if (done > 0) {
					planOut.exercises[i] = { ...planOut.exercises[i], sets: done };
					planOut.exercises.splice(i + 1, 0, entry);
				} else planOut.exercises[i] = entry;
			} else {
				if (done === 0) repo.removeSessionExercise(sessionId, fromId);
				else items[fromId] = { ...(items[fromId] ?? { weightKg: 0, reps: 0, kind: 'hold', reason: '' }), sets: done };
				repo.addSessionExercise(sessionId, to.id);
			}
			if (done === 0 && planOut) repo.removeSessionExercise(sessionId, fromId);
			applied.push(`Swapped: ${a.exercise} → ${to.name}`);
		} else if (a.type === 'adjust') {
			const id = idOf(a.exercise);
			if (!id || !ids.includes(id)) continue;
			const e = byId.get(id)!;
			const cur = items[id] ?? { weightKg: doneSets(id).at(-1)?.weightKg ?? 0, reps: 8, kind: 'hold' as const, reason: '' };
			const lb = typeof a.weightLb === 'number' && a.weightLb >= 0 && a.weightLb < 1000 ? snapLb(e.category, a.weightLb) : null;
			const reps = typeof a.reps === 'number' && a.reps >= 1 && a.reps <= 50 ? Math.round(a.reps) : null;
			if (lb == null && reps == null) continue;
			const weightKg = lb != null ? lb * LB : cur.weightKg;
			items[id] = {
				...cur,
				weightKg,
				reps: reps ?? cur.reps,
				kind: weightKg < cur.weightKg - 0.01 ? 'down' : weightKg > cur.weightKg + 0.01 ? 'up' : cur.kind,
				reason: 'Changed by the coach mid-workout.'
			};
			if (planOut) {
				const x = planOut.exercises.find((p) => p.exerciseId === id);
				if (x) Object.assign(x, { weightLb: lb ?? x.weightLb, targetReps: reps ?? x.targetReps });
			}
			applied.push(`${e.name}: ${lb != null ? `${lb} lb` : ''}${lb != null && reps != null ? ' × ' : ''}${reps != null ? `${reps} reps` : ''}`);
		} else if (a.type === 'sets') {
			const id = idOf(a.exercise);
			if (!id || !ids.includes(id) || typeof a.sets !== 'number') continue;
			const sets = Math.max(doneSets(id).length, 1, Math.min(8, Math.round(a.sets)));
			const cur = items[id] ?? { weightKg: doneSets(id).at(-1)?.weightKg ?? 0, reps: 8, kind: 'hold' as const, reason: '' };
			items[id] = { ...cur, sets };
			if (planOut) {
				const x = planOut.exercises.find((p) => p.exerciseId === id);
				if (x) x.sets = sets;
			}
			applied.push(`${a.exercise}: ${sets} sets`);
		} else if (a.type === 'remove') {
			const id = idOf(a.exercise);
			if (!id || !ids.includes(id)) continue;
			const done = doneSets(id).length;
			if (done) {
				// Keep what was logged; just stop here.
				items[id] = { ...(items[id] ?? { weightKg: 0, reps: 0, kind: 'hold', reason: '' }), sets: done };
				if (planOut) {
					const x = planOut.exercises.find((p) => p.exerciseId === id);
					if (x) x.sets = done;
				}
			} else {
				repo.removeSessionExercise(sessionId, id);
				if (planOut) planOut.exercises = planOut.exercises.filter((p) => p.exerciseId !== id);
			}
			applied.push(`Removed for today: ${a.exercise}`);
		} else if (a.type === 'dislike') {
			const e = typeof a.exercise === 'string' ? byName.get(a.exercise) : undefined;
			if (!e || disliked.has(e.name.toLowerCase())) continue;
			saveProfile({ dislikes: [...(profile.dislikes ?? []), e.name] });
			disliked.add(e.name.toLowerCase());
			applied.push(`${e.name} added to dislikes`);
		} else if (a.type === 'injury') {
			const muscles = (Array.isArray(a.muscles) ? a.muscles : []).filter(isMuscle);
			if (!muscles.length) continue;
			addInjury(muscles, typeof a.note === 'string' ? a.note : message);
			applied.push(`Noted · ${muscles.length > 2 ? 'those muscles' : muscles.join(' and ')} kept lighter for 7 days`);
		}
	}

	if (planOut) {
		dropLoneSupersets(planOut.exercises);
		repo.setSessionPlan(sessionId, planOut as unknown as Record<string, unknown>);
	}
	repo.setSessionSuggestions(sessionId, { ...sug, status: sug.status === 'pending' ? 'pending' : 'ready', items });
	const at = new Date().toISOString();
	chat.push({ role: 'user', text: message.slice(0, 1000), at }, { role: 'coach', text: reply, at, applied });
	repo.setSessionChat(sessionId, chat.slice(-40));
	return { reply, applied };
}

/** A superset whose partner was removed is just a normal exercise again. */
function dropLoneSupersets(xs: { supersetGroup: number | null; supersetWith?: boolean }[]) {
	for (const x of xs)
		if (x.supersetGroup != null && xs.filter((y) => y.supersetGroup === x.supersetGroup).length < 2) {
			x.supersetGroup = null;
			x.supersetWith = false;
		}
}

type ChatMsg = { role: 'user' | 'coach'; text: string; at: string; applied?: string[] };

/**
 * The same coach chat on the workout preview, before Start: edits the not-yet-started plan
 * (swap, remove for today, weight/reps, sets) and saves dislikes / pain like the live chat.
 * Nothing is stored on a session yet; the page keeps the plan and the chat until Start.
 */
export async function previewChat(plan: SessionPlan, message: string, history: ChatMsg[]) {
	const lib = repo.listExercises();
	const byName = new Map(lib.map((e) => [e.name, e]));
	const profile = getProfile();
	const disliked = new Set((profile.dislikes ?? []).map((d) => d.toLowerCase()));
	const out: SessionPlan = { ...plan, exercises: plan.exercises.filter((x) => byName.has(x.exercise)).map((x) => ({ ...x })) };
	const names = () => new Set(out.exercises.map((x) => x.exercise));
	const alternatives = Object.fromEntries(
		out.exercises.map((x) => [
			x.exercise,
			lib
				.filter((e) => !names().has(e.name) && !disliked.has(e.name.toLowerCase()))
				.filter((e) => hasEquipment(e.name, e.category, profile.equipment ?? []))
				.filter((e) => primaryMuscle(profileFor(e.name, e.muscle)) === x.forMuscle)
				.map((e) => e.name)
		])
	);
	const r = await callAgent('/live', {
		message: message.slice(0, 1000),
		stage: 'preview',
		session: {
			name: out.title,
			checkIn: out.checkIn,
			exercises: out.exercises.map((x) => ({
				name: x.exercise,
				equipment: x.category,
				forMuscle: x.forMuscle,
				targetSets: x.sets,
				today: { weightLb: x.weightLb, reps: x.targetReps },
				done: []
			}))
		},
		alternatives,
		profile: { avoid: profile.avoid, notes: profile.notes, dislikes: profile.dislikes },
		recentChat: history.slice(-6).map((m) => ({ role: m.role, text: m.text }))
	});
	const reply = typeof r.reply === 'string' && r.reply.trim() ? r.reply.trim().slice(0, 800) : 'Done.';
	const actions = (Array.isArray(r.actions) ? r.actions : []) as Action[];
	const applied: string[] = [];
	const find = (name: unknown) => out.exercises.findIndex((x) => x.exercise === name);

	for (const a of actions.slice(0, 8)) {
		if (a.type === 'swap') {
			const i = find(a.exercise);
			const to = typeof a.to === 'string' ? byName.get(a.to) : undefined;
			if (i < 0 || !to || !alternatives[a.exercise]?.includes(to.name) || names().has(to.name)) continue;
			const old = out.exercises[i];
			const rx = prescribeFor(to, old.forMuscle, old.sets, out.checkIn);
			out.exercises[i] = {
				...old,
				...rx,
				sets: old.sets,
				exercise: to.name,
				exerciseId: to.id,
				category: to.category,
				warmups: old.warmups.length && rx.weightLb ? warmupsFor(to.category, rx.weightLb) : [],
				reason: `Swapped in for ${a.exercise}. ${rx.reason}`
			};
			applied.push(`Swapped: ${a.exercise} → ${to.name}`);
		} else if (a.type === 'remove') {
			const i = find(a.exercise);
			if (i < 0 || out.exercises.length <= 1) continue;
			out.exercises.splice(i, 1);
			applied.push(`Removed for today: ${a.exercise}`);
		} else if (a.type === 'adjust') {
			const x = out.exercises[find(a.exercise)];
			if (!x) continue;
			const lb = typeof a.weightLb === 'number' && a.weightLb >= 0 && a.weightLb < 1000 ? snapLb(x.category, a.weightLb) : null;
			const reps = typeof a.reps === 'number' && a.reps >= 1 && a.reps <= 50 ? Math.round(a.reps) : null;
			if (lb == null && reps == null) continue;
			if (lb != null) {
				x.kind = x.weightLb != null && lb < x.weightLb ? 'down' : x.weightLb != null && lb > x.weightLb ? 'up' : x.kind;
				x.weightLb = lb;
				if (x.warmups.length) x.warmups = warmupsFor(x.category, lb);
			}
			if (reps != null) x.targetReps = reps;
			applied.push(`${x.exercise}: ${lb != null ? `${lb} lb` : ''}${lb != null && reps != null ? ' × ' : ''}${reps != null ? `${reps} reps` : ''}`);
		} else if (a.type === 'sets') {
			const x = out.exercises[find(a.exercise)];
			if (!x || typeof a.sets !== 'number') continue;
			x.sets = Math.max(1, Math.min(8, Math.round(a.sets)));
			applied.push(`${x.exercise}: ${x.sets} sets`);
		} else if (a.type === 'dislike') {
			const e = typeof a.exercise === 'string' ? byName.get(a.exercise) : undefined;
			if (!e || disliked.has(e.name.toLowerCase())) continue;
			saveProfile({ dislikes: [...(getProfile().dislikes ?? []), e.name] });
			disliked.add(e.name.toLowerCase());
			applied.push(`${e.name} added to dislikes`);
		} else if (a.type === 'injury') {
			const muscles = (Array.isArray(a.muscles) ? a.muscles : []).filter(isMuscle);
			if (!muscles.length) continue;
			addInjury(muscles, typeof a.note === 'string' ? a.note : message);
			applied.push(`Noted · ${muscles.length > 2 ? 'those muscles' : muscles.join(' and ')} kept lighter for 7 days`);
		}
	}
	dropLoneSupersets(out.exercises);
	out.totalSets = out.exercises.reduce((n, x) => n + x.sets, 0);
	out.minutes = sessionMinutes(out.exercises);
	const at = new Date().toISOString();
	const chat: ChatMsg[] = [...history, { role: 'user', text: message.slice(0, 1000), at }, { role: 'coach', text: reply, at, applied }];
	return { plan: out, reply, applied, chat: chat.slice(-40) };
}
