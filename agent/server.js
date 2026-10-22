// Coach AI agent microservice for "strengthmaxxing".
// Node 22, ESM, stdlib only. Talks to the model via the personal Claude
// subscription through the `claude` CLI (headless/print mode), or falls back
// to the Anthropic Messages API when ANTHROPIC_API_KEY is set.
//
// Contract (see ../API_CONTRACT.md, "Coach agent service"):
//   GET  /health   -> {ok:true}
//   POST /plan     -> {plan:{name,weeks,deloadWeek,progression,days:[{name,dayOfWeek,exercises:[{name,sets,reps,restSec,weightKg,notes}]}]},rationale,reply}
//   POST /progress -> {adjustments:[{name,suggestedWeightKg,suggestedReps,deltaPct,reason}],summary}

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.PORT) || 8787;
const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-opus-5-5';
const AGENT_EFFORT = process.env.AGENT_EFFORT || 'medium'; // low | medium | high | xhigh | max
const CLI_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 240_000; // multi-week plans take a while

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

function callClaudeCli(prompt) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLI_BIN,
      ['-p', '--output-format', 'json', '--model', AGENT_MODEL, '--effort', AGENT_EFFORT],
      { timeout: MODEL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: cliEnv() },
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
async function callAnthropicApi(prompt) {
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
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`anthropic api ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  if (data.stop_reason === 'refusal') throw new Error('model declined the request');
  const text = (data.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');
  if (!text) throw new Error('anthropic api returned no text');
  return text;
}

// Prefer CLI; else API key; else throw so the handler can 502.
async function askModel(prompt) {
  if (await probeCli()) {
    try {
      return await callClaudeCli(prompt);
    } catch (e) {
      // If the CLI genuinely failed but we have an API key, try that.
      if (process.env.ANTHROPIC_API_KEY) return callAnthropicApi(prompt);
      throw e;
    }
  }
  if (process.env.ANTHROPIC_API_KEY) return callAnthropicApi(prompt);
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
    '"equipment"?:[string],"avoid"?:string,"notes"?:string},' +
    '"plan":{"name":string,"weeks":number|null,"deloadWeek":number|null,"progression":string,' +
    '"days":[{"name":string,"dayOfWeek":"Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun"|null,"estMinutes":number,' +
    '"exercises":[{"name":string,"sets":number,"reps":number,"restSec":number,"weightKg":number|null,"notes":string}]}]},' +
    '"rationale":string,"reply":string}';
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
    'Plan shape:',
    '- "weeks": null for an open-ended cycle they repeat until they want a change (the default). Use a ' +
      'number only if they ask for a fixed-length block. "deloadWeek": null unless they ask for one.',
    '- "dayOfWeek": null when the days are a rotation done in order (e.g. they train most days with ' +
      'flexible rest days). Set weekdays only if they have a fixed weekly schedule.',
    '- weightKg = the starting working weight. Base it on their history (about 75-85% of e1rm for 5-8 ' +
      'reps); estimate a conservative start from related lifts when there is no history; null ONLY for ' +
      'bodyweight moves. Round to what a US gym loads (2.27 kg = 5 lb steps for barbell/machine/cable, ' +
      '1.13 kg = 2.5 lb for dumbbells).',
    '- "progression": one or two sentences on how load/reps move session to session.',
    '',
    '"profile": the lifter\'s standing preferences as of now, so they are remembered next time: ' +
      'daysPerWeek (7 = every day), sessionMin (their MAXIMUM session minutes), goal, experience, ' +
      'equipment, avoid (injuries/exercises to skip), notes (other standing preferences in one or two ' +
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
  if (input.feedback?.length) {
    lines.push('', `Your previous answer broke these requirements — fix them: ${JSON.stringify(input.feedback)}`);
  }
  lines.push('', `Output ONLY minified JSON of this shape: ${schema}`);
  return lines.join('\n');
}

function progressPrompt(input) {
  const schema =
    '{"adjustments":[{"name":string,"suggestedWeightKg":number,"suggestedReps":number,"deltaPct":number,"reason":string}],"summary":string}';
  return [
    SYSTEM_RULES,
    '',
    'Task: adjust today\'s working weights and reps per exercise via autoregulation.',
    `Inputs (JSON): ${JSON.stringify(input)}`,
    'readiness is 0-100: higher = push harder / add load, lower = deload / reduce load or reps.',
    'If readiness is null it was not logged today: assume a normal day, progress conservatively.',
    'targetWeightKg/targetReps are what their program plans for today. When targetWeightKg is set, ' +
      'start from it: the program already accounts for time off and weekly progression. Use lastWeightKg/lastReps ' +
      'only to sanity-check (e.g. nudge up if they clearly beat the target last time). When targetWeightKg is ' +
      'null, base it on lastWeightKg and lastReps vs targetReps.',
    'Then modulate by readiness and context (timeOfDay, kcalBalance deficit, sleepHours, sorenessNote).',
    'deltaPct is the percent change vs targetWeightKg when set, else vs lastWeightKg (may be negative).',
    `Write weights inside "reason" and "summary" in ${input.units === 'kg' ? 'kg' : 'pounds (lb), never kg'}.`,
    'CRITICAL: each output "name" MUST exactly match the corresponding input exercise name.',
    'Include one adjustment object per input exercise.',
    `Output ONLY minified JSON of this shape: ${schema}`,
  ].join('\n');
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

async function handleModelEndpoint(res, prompt) {
  // One retry on unparseable output — models occasionally wrap JSON in prose.
  for (let attempt = 0; attempt < 2; attempt++) {
    let text;
    try {
      text = await askModel(
        attempt === 0 ? prompt : `${prompt}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object.`
      );
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
    return handleModelEndpoint(res, prompt);
  }

  return send(res, 404, { error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`coach agent listening on :${PORT}`);
});
