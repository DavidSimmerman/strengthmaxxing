/**
 * Stand-in for the coach agent so the coach flow can be tested without calling Claude.
 *   PORT=4399 node scripts/fake-agent.mjs
 * Echoes back a plan built from the request's library + daysPerWeek.
 */
import { createServer } from 'node:http';
createServer(async (req, res) => {
	let body = '';
	for await (const c of req) body += c;
	const b = body ? JSON.parse(body) : {};
	await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY_MS) || 0)); // simulate a slow model
	const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
	if (req.url === '/plan') {
		const lib = b.library ?? [];
		const days = Array.from({ length: b.profile?.daysPerWeek ?? 2 }, (_, i) => ({
			name: `Day ${i + 1}`, dayOfWeek: ['Mon', 'Thu', 'Sat'][i % 3],
			exercises: lib.slice(i * 3, i * 3 + 3).map((name) => ({ name, sets: 3, reps: 5, restSec: 120, weightKg: b.currentPlan ? 62.27 : 60, notes: '' }))
		}));
		return send({ plan: { name: b.currentPlan ? 'Revised' : 'Test Block', weeks: 6, deloadWeek: 6, progression: '+5 lb/week', days }, rationale: 'test', reply: b.currentPlan ? 'Swapped it.' : 'Here you go.' });
	}
	if (req.url === '/progress')
		return send({ adjustments: b.workout.exercises.map((e) => ({ name: e.name, suggestedWeightKg: 62.5, suggestedReps: e.targetReps, kind: 'up', deltaPct: 4, reason: 'test' })), summary: 'ok' });
	if (req.url === '/live') {
		// Keyword stand-in for the mid-workout coach: "heavy" → back off 15%, "hate X" → dislike +
		// swap the last exercise, "hurt" → note pain on front delts and cut the first exercise to 2 sets.
		const m = b.message.toLowerCase();
		const xs = b.session.exercises;
		const open = xs.find((x) => x.done.length < x.targetSets && x.today?.weightLb > 0) ?? xs[0];
		const actions = [];
		if (m.includes('heavy') && open.today) actions.push({ type: 'adjust', exercise: open.name, weightLb: open.today.weightLb * 0.85, reps: null });
		if (m.includes('hate')) {
			const last = xs.at(-1);
			actions.push({ type: 'dislike', exercise: last.name });
			if (b.alternatives[last.name]?.[0]) actions.push({ type: 'swap', exercise: last.name, to: b.alternatives[last.name][0] });
		}
		if (m.includes('hurt')) actions.push({ type: 'injury', muscles: ['frontDelts', 'nonsense'], note: b.message }, { type: 'sets', exercise: xs[0].name, sets: 2 });
		return send({ reply: `Fake coach: ${actions.length} change(s).`, actions });
	}
	if (req.url === '/note') return send({ title: 'Fake note', body: `Fake ${b.kind} note.` });
	if (req.url === '/review') {
		// Swaps the last exercise for its first alternative (when there is one) to exercise the swap path.
		const xs = b.plan.exercises;
		return send({
			summary: 'Reviewed by the fake coach.',
			items: xs.map((e, i) => ({ name: e.name, swapTo: i === xs.length - 1 ? (b.alternatives?.[e.name]?.[0] ?? null) : null, reason: `Reviewed: ${e.name}.` }))
		});
	}
	res.writeHead(200); res.end('{"ok":true}');
}).listen(Number(process.env.PORT) || 4399);
