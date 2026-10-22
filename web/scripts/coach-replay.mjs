// Replays a real coach conversation against a running server + real agent and checks each
// plan against what was asked.  node scripts/coach-replay.mjs <url>  (server API_TOKEN=tok)
// Replays David's real coach conversation and checks each plan against what he asked.
const B = process.argv[2], H = { 'content-type': 'application/json', authorization: 'Bearer tok' };
const api = async (m, p, b) => { const t = await (await fetch(B + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined })).text(); return t ? JSON.parse(t) : null; };
const msgs = [
`Can you build me a workout plan?

My primary goal is to increase the visual volume of my muscles for the best visual appearance with the secondary goal of just being stronger.

I'm on a fairly intense running plan. In the past I have avoided leg days because it makes my legs very sore and I can't do my run for a couple of days or so. If you think I should have leg days still, feel free to add them, but I think I'd rather keep them less frequent and light at least until I get used to them so I can recover by the next days run.   Also not mentioned in here, but I want really nice abs. I know that is a little more about diet, but I'd like to make sure my workouts include that as well.   I have a smith machine, a cable machine, pull up bar, dumbells, a bench and a ton of cable machine attachments.   I generally like a variety of workouts. In the past when I have one workout I have to do too many times in a workout plan I get tired of it, so variety is best.   I think I prefer less sets. My last workout plan had 4 sets per exercise and I would have to hold back to make sure I had the energy for the other sets and stuff. I'd rather have just 2 or 3 I can go really hard on.   I try to workout every day with random rest days in there, so I'd like a plan that is expecting that I workout with no rest, so I can mix up when the rest day is.   I typically work out on my lunch break for anywhere from 30 mins to 1 hour so the plan for each day should be in between that range.`,
`I don't think you got what I said. I want to workout pretty much every day. This plan has only 4 days of working out that isn't what I asked for. 8 different lifts also seems like it could take over an hour, no? Or do you think that should be able to fit in an hour? Also why a 5 week plan with a deload? Why not just a repeated cycle that goes on until I want to change it?`,
`Abs every day seems excessive, no?`
];
const lib = Object.fromEntries((await api('GET', '/api/exercises')).map((e) => [e.id, e.category]));
const dayMin = (d) => Math.round(5 + d.exercises.reduce((m, x) => m + x.sets * (60 + x.restSec), 0) / 60);
await api('DELETE', '/api/coach/chat');
let prevDays = null;
for (const [i, text] of msgs.entries()) {
  const t0 = Date.now();
  const r = await api('POST', '/api/coach/chat', { text });
  const id = r.messages[1].id;
  let m;
  for (;;) { await new Promise((s) => setTimeout(s, 3000)); m = (await api('GET', '/api/coach/chat')).messages.find((x) => x.id === id); if (!m.pending) break; }
  console.log(`\n=== Turn ${i + 1} (${((Date.now() - t0) / 1000).toFixed(0)}s): "${text.slice(0, 50)}..."`);
  console.log(`coach: ${m.text}`);
  console.log(`sources (${(m.sources ?? []).length}): ${(m.sources ?? []).map((x) => x.title + ' <' + x.url + '>').join(' | ') || 'none'}`);
  const p = m.plan;
  if (!p) { console.log('(no new plan — answered in text)'); continue; }
  console.log(`plan: ${p.name} | weeks=${p.weeks} deload=${p.deloadWeek} | ${p.days.length} days`);
  for (const d of p.days) console.log(`  ${d.dayOfWeek ?? '-'} ${d.name}: ${d.exercises.length} lifts, ~${dayMin(d)} min, sets ${[...new Set(d.exercises.map((x) => x.sets))].join('/')} | ${d.exercises.map((x) => `${x.name} (${lib[x.exerciseId] ?? '??'})`).join(', ')}`);
  const sets = p.days.flatMap((d) => d.exercises.map((x) => x.sets));
  const legDays = p.days.filter((d) => /leg/i.test(d.name)).length;
  const absDays = p.days.filter((d) => d.exercises.some((x) => /crunch|plank|leg raise|ab wheel|russian|twist/i.test(x.name))).length;
  const checks = {
    'no fixed block/deload (repeating cycle)': p.weeks == null && p.deloadWeek == null,
    'every day fits 30-60 min': p.days.every((d) => dayMin(d) <= 65),
    '2-3 sets per exercise': sets.every((s) => s >= 2 && s <= 3),
    'legs light / infrequent (<=1 leg day per cycle)': legDays <= 1,
    'abs included': absDays >= 1,
    'only his equipment (smith/cable/dumbbell/pull-up bar/bench)': p.days.every((d) => d.exercises.every((x) => !['barbell', 'machine', 'kettlebell'].includes(lib[x.exerciseId]) && !/^Dip$/.test(x.name) || /Pull-Up|Chin-Up/.test(x.name))),
    'all lifts in library': p.days.every((d) => d.exercises.every((x) => x.exerciseId)),
    ...(i === 2 && prevDays ? { [`kept the ${prevDays} days from the plan under discussion`]: p.days.length === prevDays } : {}),
    ...(i === 2 ? { 'abs no longer every day': absDays < p.days.length } : {})
  };
  for (const [k, v] of Object.entries(checks)) console.log(`  ${v ? 'PASS' : 'FAIL'} ${k}`);
  prevDays = p.days.length;
}
console.log('\nprofile now:', JSON.stringify((await api('GET', '/api/coach/profile')).profile));
