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
		return send({ adjustments: b.workout.exercises.map((e) => ({ name: e.name, suggestedWeightKg: 62.5, suggestedReps: e.targetReps, deltaPct: 4, reason: 'test' })), summary: 'ok' });
	res.writeHead(200); res.end('{"ok":true}');
}).listen(Number(process.env.PORT) || 4399);
