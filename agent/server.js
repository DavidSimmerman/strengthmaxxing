// Coach AI agent microservice for "strengthmaxxing".
// Node 22, ESM, stdlib only. Talks to the model via the personal Claude
// subscription through the `claude` CLI (headless/print mode), or falls back
// to the Anthropic Messages API when ANTHROPIC_API_KEY is set.
//
// Contract (see ../API_CONTRACT.md, "Coach agent service"):
//   GET  /health   -> {ok:true}
//   POST /plan     -> {plan:{name,weeks,deloadWeek,progression,days:[{name,dayOfWeek,exercises:[{name,sets,reps,restSec,weightKg,notes}]}]},rationale,reply}
//   POST /progress -> {adjustments:[{name,suggestedWeightKg,suggestedReps,deltaPct,reason}],summary}
//   POST /review   -> {summary,items:[{name,swapTo,reason}]}  (today's generated workout)

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.PORT) || 8787;
const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-opus-5-5';
const AGENT_EFFORT = process.env.AGENT_EFFORT || 'medium'; // low | medium | high | xhigh | max
const CLI_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 240_000; // multi-week plans take a while
// Plan requests may search the web first (AGENT_RESEARCH=off disables). Research runs take minutes.
const RESEARCH = process.env.AGENT_RESEARCH !== 'off';
const RESEARCH_TIMEOUT_MS = Number(process.env.AGENT_RESEARCH_TIMEOUT_MS) || 900_000;

// ---------------------------------------------------------------------------
// Model invocation
// ---------------------------------------------------------------------------

// Is the `claude` CLI usable? Cache success forever; retry failures after a
// minute so one cold-start hiccup doesn't disable the CLI path until restart.
let cliAvailable = null;
let reprobeAt = 0;
function probeCli() {
  if (cliAvailable === true) return Promise.resolve(true);
  if (cliAvailable === false && Date.now() < reprobeAt) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(CLI_BIN, ['--version'], { timeout: 10_000 }, (err) => {
      cliAvailable = !err;
      reprobeAt = Date.now() + 60_000;
      resolve(cliAvailable);
    });
  });
}

// Call the `claude` CLI in print mode. The CLI returns a JSON envelope whose
// `result` field is the model's text reply. Prompt is passed on stdin to dodge
// argv length/escaping limits.
// The CLI warns about conflicting auth when both are set, and compose passes an empty
// ANTHROPIC_API_KEY when unused — so the CLI only sees the key when there's no token.
function cliEnv() {
  const env = { ...process.env };
  if (!env.ANTHROPIC_API_KEY || env.CLAUDE_CODE_OAUTH_TOKEN) delete env.ANTHROPIC_API_KEY;
  return env;
}

function callClaudeCli(prompt, { research = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLI_BIN,
      ['-p', '--output-format', 'json', '--model', AGENT_MODEL, '--effort', AGENT_EFFORT,
        ...(research ? ['--allowedTools', 'WebSearch', 'WebFetch'] : [])],
      { timeout: research ? RESEARCH_TIMEOUT_MS : MODEL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: cliEnv() },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(`claude cli failed: ${err.message} ${stderr || ''}`.trim()));
          return;
        }
        let envelope;
        try {
          envelope = JSON.parse(stdout);
        } catch {
          reject(new Error('claude cli did not return JSON envelope'));
          return;
        }
        if (envelope.is_error || typeof envelope.result !== 'string') {
          reject(new Error(`claude cli error: ${envelope.result || envelope.subtype || 'unknown'}`));
          return;
        }
        resolve(envelope.result);
      }
    );
    child.stdin.end(prompt);
  });
}

// Fallback: Anthropic Messages API. Returns the concatenated text of the reply.
async function callAnthropicApi(prompt, { research = false } = {}) {
  const messages = [{ role: 'user', content: prompt }];
  // Server-side web tools may pause a long turn; resend to let it continue (a few times max).
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        // if a safety classifier declines, the API retries on a fallback model instead of failing
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      body: JSON.stringify({
        model: AGENT_MODEL,
        max_tokens: 16000,
        output_config: { effort: AGENT_EFFORT },
        fallbacks: 'default',
        ...(research
          ? { tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 8 },
                      { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 }] }
          : {}),
        messages,
      }),
      signal: AbortSignal.timeout(research ? RESEARCH_TIMEOUT_MS : MODEL_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`anthropic api ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    if (data.stop_reason === 'refusal') throw new Error('model declined the request');
    if (data.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: data.content });
      continue;
    }
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new Error('anthropic api returned no text');
    return text;
  }
  throw new Error('anthropic api: research did not finish');
}

// Prefer CLI; else API key; else throw so the handler can 502.
async function askModel(prompt, opts = {}) {
  if (await probeCli()) {
    try {
      return await callClaudeCli(prompt, opts);
    } catch (e) {
      // If the CLI genuinely failed but we have an API key, try that.
      if (process.env.ANTHROPIC_API_KEY) return callAnthropicApi(prompt, opts);
      throw e;
    }
  }
  if (process.env.ANTHROPIC_API_KEY) return callAnthropicApi(prompt, opts);
  throw new Error('no model backend: claude CLI unavailable and ANTHROPIC_API_KEY unset');
}

// Strip accidental ```json fences etc. and JSON.parse. Throws on failure.
function parseModelJson(text) {
  let s = String(text).trim();
  // Remove leading/trailing markdown code fences if present.
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) s = fence[1].trim();
  // Otherwise, if there's stray prose, grab the outermost JSON object.
  if (!s.startsWith('{')) {
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last > first) s = s.slice(first, last + 1);
  }
  return JSON.parse(s);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_RULES =
  'You are a strength coach. Apply progressive overload, RIR/RPE-based intensity, and ' +
  'readiness-based autoregulation. Strictly honor the given equipment and constraints. ' +
  'Respond with ONLY strict minified JSON matching the requested schema. No markdown, no ' +
  'code fences, no commentary before or after the JSON.';

function planPrompt(input) {
  const schema =
    '{"requirements":[string],' +
    '"profile":{"goal"?:string,"daysPerWeek"?:number,"sessionMin"?:number,"experience"?:string,' +
    '"equipment"?:[string],"avoid"?:string,"dislikes"?:[string],"notes"?:string},' +
    '"workoutEdit":{"workoutId":number,"exercises":[{"name":string,"sets":number,"reps":number,"restSec":number,"weightKg":number|null,"perSide":boolean}]}|null,' +
    '"plan":null|{"name":string,"weeks":number|null,"deloadWeek":number|null,"progression":string,' +
    '"days":[{"name":string,"dayOfWeek":"Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun"|null,"estMinutes":number,' +
    '"exercises":[{"name":string,"sets":number,"reps":number,"restSec":number,"weightKg":number|null,"perSide":boolean,"notes":string}]}]},' +
    '"sources":[{"title":string,"url":string}],"rationale":string,"reply":string}';
  const lines = [
    SYSTEM_RULES,
    '',
    'Task: you are this lifter\'s coach in an ongoing chat. Design or revise their training plan.',
    `Saved profile (JSON, may be empty or out of date): ${JSON.stringify(input.profile ?? {})}`,
    `The whole conversation so far, oldest first. Everything the lifter said still applies unless ` +
      `they later changed it: ${JSON.stringify(input.conversation ?? [])}`,
    `Their newest message, which you are answering now: ${JSON.stringify(input.request ?? '')}`,
    `Training history (JSON; weights in kg; e1rm = estimated 1-rep max): ${JSON.stringify(input.history ?? {})}`,
    `Exercise library as "Name [equipment]". Use ONLY these exact names (without the bracket): ` +
      `${JSON.stringify(input.library ?? [])}`,
    'Never program an exercise in profile.dislikes (they are left out of the library above).',
    'Use only exercises their equipment supports. "barbell" needs a barbell and rack and is NOT a Smith ' +
      'machine; "machine" means that specific machine (leg curl, leg press, pec deck...). When they list ' +
      'equipment, treat anything not listed as unavailable; bodyweight moves need only what they name ' +
      '(e.g. dips need a dip station). Prefer the Smith machine version over a barbell lift they cannot do.',
    '',
    'How to work:',
    '1. "requirements": list every concrete requirement and preference the lifter has stated anywhere ' +
      'in the conversation or profile (training days, session length, sets per exercise, goals, what to ' +
      'emphasize or keep light, variety, equipment, injuries, likes/dislikes, rest-day pattern). Use their ' +
      'latest statement when they changed their mind. Never invent a requirement they did not state.',
    '2. Build the plan so it satisfies EVERY requirement. Where they gave no preference, choose what best ' +
      'serves their goal. Nothing in these instructions overrides what they asked for.',
    '3. Each day\'s "estMinutes" = realistic time to finish it: about 1 minute of work per set plus each ' +
      'set\'s rest, plus 5 minutes to warm up and move between stations. It MUST fit their stated session ' +
      'length; if it does not, cut exercises or sets.',
    '4. Check the finished plan against each requirement before answering.',
    '',
    'Research: you can search the web and read pages. When designing a new plan or making a substantive ' +
      'change, first look up current, reputable evidence relevant to THIS lifter (e.g. weekly sets per ' +
      'muscle for hypertrophy, training to failure with low set counts, combining lifting with heavy ' +
      'running, ab training frequency, rest intervals between sets). Prefer peer-reviewed reviews and recognized experts; ignore ' +
      'listicles. Keep it to a few targeted searches. Skip research for small edits or quick questions. ' +
      'List what actually informed the plan in "sources" (empty when you did not research).',
    '',
    'Plan shape:',
    '- "weeks": null for an open-ended cycle they repeat until they want a change (the default). Use a ' +
      'number only if they ask for a fixed-length block. "deloadWeek": null unless they ask for one.',
    '- "dayOfWeek": null when the days are a rotation done in order (e.g. they train most days with ' +
      'flexible rest days). Set weekdays only if they have a fixed weekly schedule.',
    '- weightKg = the starting working weight. Base it on their history (about 75-85% of e1rm for 5-8 ' +
      'reps); estimate a conservative start from related lifts when there is no history; null ONLY for ' +
      'bodyweight moves. ' + (input.rounding || 'Round to what a US gym loads (2.27 kg = 5 lb steps for ' +
      'barbell/machine/cable, 1.13 kg = 2.5 lb for dumbbells).'),
    '- "progression": one or two sentences on how load/reps move session to session.',
    '- "restSec" per exercise is part of the plan, chosen from evidence for their goal, not a ' +
      'default. For hypertrophy (Singer 2024 meta-analysis: >60 s beats shorter, little gain past ~90 s ' +
      'for isolation; Schoenfeld 2016: 3 min beat 1 min on compounds): heavy barbell/Smith compounds ' +
      '150-240 s (default 180), machine or dumbbell compounds 90-180 s (default 120), isolation 60-120 s ' +
      '(default 90), abs/core 45-90 s (default 60). Add ~30 s to lower-body compounds for someone who ' +
      'also runs a lot. For one-arm / one-leg exercises done one side then the other, restSec is the ' +
      'rest after BOTH sides: for arms, subtract roughly one side\'s working time (the resting arm ' +
      'recovers while the other works), never below 60 s; for legs keep the full rest (fatigue ' +
      'carries across sides).',
    '- "perSide": true when the exercise is done one arm / one leg at a time (e.g. single-arm cable row, ' +
      'one-arm dumbbell row, concentration curl, split squat): each set is left then right, "reps" is per ' +
      'side, weightKg is the weight in one hand / on one side. false for everything else.',
    '',
    '"profile": the lifter\'s standing preferences as of now, so they are remembered next time: ' +
      'daysPerWeek (7 = every day), sessionMin (their MAXIMUM session minutes), goal, experience, ' +
      'equipment, avoid (injuries to work around), dislikes (exercise names from the library they said ' +
      'they dislike or never want; return the COMPLETE list including ones already saved, and remove one ' +
      'only if they say they are OK with it again), notes (other standing preferences in one or two ' +
      'short sentences, e.g. "2-3 hard sets per exercise; likes variety; runs a lot, keep legs light"). ' +
      'Include only what you know.',
    `Write every weight in prose ("progression", "rationale", "reply") in ${input.units === 'kg' ? 'kg' : 'pounds (lb), never kg'}. ` +
      'Only the weightKg JSON fields are in kg.',
    '"rationale" = 2-3 sentences on how the plan meets their goals. "reply" = a short, direct chat ' +
      'reply (1-3 sentences) to their newest message.',
  ];
  if (input.currentPlan) {
    lines.push(
      '',
      `The plan currently under discussion (JSON; the last one you proposed, whether or not they ` +
        `saved it): ${JSON.stringify(input.currentPlan)}`,
      'If they ask for a brand-new plan, design one from scratch. If they ask to change something, ' +
        'revise THIS plan: change only what the request requires and keep everything else identical ' +
        '(same number of days, same structure), then say what changed in "reply". If they only ask a ' +
        'question, return this plan unchanged and answer in "reply".'
    );
  }
  if (input.workouts?.length) {
    lines.push(
      '',
      `Their saved workouts (JSON; weights in kg): ${JSON.stringify(input.workouts)}`,
      'If they ask to change ONE of these saved workouts by name (e.g. "swap rows for pulldowns in ' +
        'Pull A", "make Legs shorter"), return "workoutEdit" with that workoutId and its COMPLETE new ' +
        'exercise list in order: apply only the requested change and copy every other exercise exactly ' +
        '(same sets, reps, rest, weight, perSide). Set "plan" to null and describe the change in "reply". ' +
        'Otherwise set "workoutEdit" to null.'
    );
  }
  if (input.feedback?.length) {
    lines.push('', `Your previous answer broke these requirements — fix them: ${JSON.stringify(input.feedback)}`);
  }
  lines.push('', `Output ONLY minified JSON of this shape: ${schema}`);
  return lines.join('\n');
}

function progressPrompt(input) {
  const schema =
    '{"adjustments":[{"name":string,"suggestedWeightKg":number,"suggestedReps":number,' +
    '"kind":"up"|"hold"|"down","deltaPct":number,"reason":string}],"summary":string}';
  const lb = input.units !== 'kg';
  return [
    SYSTEM_RULES,
    '',
    "Task: suggest today's working weight and reps for each exercise in this workout.",
    `Inputs (JSON; weights in kg): ${JSON.stringify(input)}`,
    '',
    'How to decide, per exercise:',
    '1. Start from how they did LAST TIME on that exercise (lastTime.sets, every set). Rep target is ' +
      'targetReps (per side when perSide is true; then lastTime.sets has one entry per side, side "L"/"R", and ' +
      'the weaker side decides). If they hit the target on every set with reps to spare, progress: one small load step ' +
      `(${input.rounding ? 'the next setting the equipment allows; see rounding' : lb ? '5 lb barbell/smith/machine/cable, 2.5 lb per dumbbell' : '2.5 kg barbell/smith/machine/cable, 1 kg per dumbbell'}) ` +
      'or +1-2 reps. If some sets fell short, hold. If reps fell off sharply or most sets missed, go down ' +
      'one step. No lastTime: use plannedWeightKg, else a conservative estimate from their other lifts.',
    '2. Adjust for TODAY. checkin.energy is 1 (drained) to 5 (great); checkin.soreness is per body area, ' +
      '0 fresh, 1 a bit, 2 very (it is what they reported; sorenessEstimate is from recent training and ' +
      'only applies when checkin is missing). Use the soreness of the exercise\'s own area. Energy 1-2 or ' +
      'area "very" sore: no increase, usually one step down or fewer reps. Area "a bit" sore: no increase. ' +
      'Energy 4-5 and the area fresh: progress as in step 1. readiness (0-100) and context also apply.',
    '3. STANDING PREFERENCES OVERRIDE PROGRESSION. Read profile.notes, profile.avoid and profile.goal. If ' +
      'they want an area kept light or easy (e.g. legs light because they run), NEVER raise load or reps ' +
      'there just because it felt easy: keep it at or below last time, and lower it if they are sore. Only ' +
      'go up in that area if they explicitly asked to. Same for any other "take it easy on X" preference.',
    '',
    '"kind": up / hold / down vs last time (vs plannedWeightKg when there is no last time). "deltaPct" = ' +
      'percent load change on the same basis.',
    '"reason": ONE short sentence citing last time\'s numbers and the deciding factor for today, e.g. ' +
      '"Hit 10 on both sets last time and chest is fresh: +5 lb." or "Kept light: legs stay easy for your running."',
    '"summary": one or two sentences on today overall.',
    `Write weights in "reason" and "summary" in ${lb ? 'pounds (lb), never kg' : 'kg'}. Only suggestedWeightKg is in kg.`,
    'CRITICAL: each output "name" MUST exactly match the input exercise name. One adjustment per input exercise.',
    `Output ONLY minified JSON of this shape: ${schema}`,
  ].join('\n');
}

function reviewPrompt(input) {
  const schema = '{"summary":string,"items":[{"name":string,"swapTo":string|null,"reason":string}]}';
  const lb = input.units !== 'kg';
  return [
    SYSTEM_RULES,
    '',
    "Task: review today's generated workout before the lifter starts it. A rules engine already chose the " +
      'muscles, sets, reps, weights and rest from their recovery, weekly volume per muscle and history. Do NOT ' +
      'change sets, reps, weights or rest.',
    `Inputs (JSON): ${JSON.stringify(input)}`,
    '',
    '1. Exercise choice. For each exercise you MAY swap it for one name from alternatives[exerciseName] ' +
      '(same muscle, equipment they own) when that is clearly better for them today: profile.avoid / notes ' +
      '(injuries, "legs light because I run"), a joint likely to be irritated, or a much better stretch-position ' +
      'option. Prefer keeping exercises they have history on (engineReason mentions last time) so progress stays ' +
      'trackable. Most days: no swaps. swapTo must be null or an exact name from that list.',
    '2. "reason": ONE short sentence per exercise, in plain words, saying why it is in today\'s session and why ' +
      'this weight/reps. Use engineReason\'s facts (last time, weekly sets, recovery, soreness) - never invent ' +
      'numbers. If you swapped, say why. e.g. "Chest is your top priority and fresh; you hit 10 on every set at 135, ' +
      'so 140 today."',
    '3. "summary": one or two sentences on today: what it focuses on and why the rest is resting (see resting). ' +
      'Encouraging but not cheesy.',
    `Write weights in ${lb ? 'pounds (lb)' : 'kg'}. One item per input exercise; "name" must exactly match the input name.`,
    `Output ONLY minified JSON of this shape: ${schema}`,
  ].join('\n');
}

function validateReview(b) {
  if (!b || typeof b !== 'object') return 'body required';
  if (!b.plan || !Array.isArray(b.plan.exercises)) return 'plan.exercises[] required';
  if (b.alternatives != null && typeof b.alternatives !== 'object') return 'alternatives must be an object';
  return null;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy(); // stop reading — don't buffer the rest of an oversized body
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function validatePlan(b) {
  if (!b || typeof b !== 'object') return 'body required';
  if (typeof b.request !== 'string' && (!b.profile || typeof b.profile !== 'object'))
    return 'request (string) or profile (object) required';
  const days = b.profile?.daysPerWeek;
  if (days !== undefined && (!Number.isFinite(days) || days < 1 || days > 7)) return 'profile.daysPerWeek must be 1-7';
  if (b.library !== undefined && !Array.isArray(b.library)) return 'library must be an array of names';
  return null;
}

function validateProgress(b) {
  if (!b || typeof b !== 'object') return 'body required';
  if (!b.workout || !Array.isArray(b.workout.exercises)) return 'workout.exercises[] required';
  // readiness may be null — the web proxy sends null when no readiness is logged today.
  if (b.readiness != null && !Number.isFinite(b.readiness)) return 'readiness (number|null) required';
  return null;
}

async function handleModelEndpoint(res, prompt, opts = {}) {
  // One retry on unparseable output — models occasionally wrap JSON in prose.
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    try {
      // The retry only reformats, so it skips research.
      text = attempt === 0
        ? await askModel(prompt, opts)
        : await askModel(`${prompt}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object.`);
    } catch (e) {
      return send(res, 502, { error: `model call failed: ${e.message}` });
    }
    try {
      return send(res, 200, parseModelJson(text));
    } catch {
      /* retry */
    }
  }
  return send(res, 502, { error: 'bad model output' });
}

const server = createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (req.method === 'GET' && url === '/health') {
    const auth = process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'subscription token'
      : process.env.ANTHROPIC_API_KEY ? 'api key' : 'none';
    return send(res, 200, { ok: true, cli: await probeCli(), auth, model: AGENT_MODEL, effort: AGENT_EFFORT });
  }

  if (req.method === 'POST' && (url === '/plan' || url === '/progress')) {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    const err = url === '/plan' ? validatePlan(body) : validateProgress(body);
    if (err) return send(res, 400, { error: err });
    const prompt = url === '/plan' ? planPrompt(body) : progressPrompt(body);
    return handleModelEndpoint(res, prompt, { research: url === '/plan' && RESEARCH && !body.noResearch });
  }

  if (req.method === 'POST' && url === '/review') {
    let body;
    try {
      body = await readBody(req);
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
    const err = validateReview(body);
    if (err) return send(res, 400, { error: err });
    return handleModelEndpoint(res, reviewPrompt(body));
  }

  return send(res, 404, { error: 'not found' });
});

// Research turns run for minutes; Node's default 5-minute request timeout would cut them off.
server.requestTimeout = 0;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`coach agent listening on :${PORT}`);
});
