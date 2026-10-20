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
function callClaudeCli(prompt) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      CLI_BIN,
      ['-p', '--output-format', 'json', '--model', AGENT_MODEL, '--effort', AGENT_EFFORT],
      { timeout: MODEL_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
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
    '{"plan":{"name":string,"weeks":number,"deloadWeek":number|null,"progression":string,' +
    '"days":[{"name":string,"dayOfWeek":"Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun",' +
    '"exercises":[{"name":string,"sets":number,"reps":number,"restSec":number,"weightKg":number|null,"notes":string}]}]},' +
    '"rationale":string,"reply":string}';
  const lines = [
    SYSTEM_RULES,
    '',
    'Task: design a multi-week strength program for this one lifter.',
    `Profile (JSON): ${JSON.stringify(input.profile ?? {})}`,
    `What they asked for, in their words: ${JSON.stringify(input.request ?? '')}`,
    `Recent conversation, oldest first (context only): ${JSON.stringify(input.conversation ?? [])}`,
    `Training history (JSON; weights in kg; e1rm = estimated 1-rep max): ${JSON.stringify(input.history ?? {})}`,
    `Exercise library — use ONLY these exact names: ${JSON.stringify(input.library ?? [])}`,
    `Produce exactly ${input.profile?.daysPerWeek ?? 4} training days per week, each fitting in ` +
      `${input.profile?.sessionMin ?? 60} minutes including rest.`,
    'Program length 4-8 weeks; put a deload in the last week unless the request says otherwise.',
    'weightKg = the week-1 working weight. Base it on their history (about 75-85% of e1rm for 5-8 reps). ' +
      'For exercises with no history, estimate a conservative start from their related lifts. Use null ' +
      'ONLY for pure bodyweight moves (pull-ups, dips, leg raises). Round to what a US gym loads ' +
      '(multiples of 2.27 kg = 5 lb for barbell/machine, 1.13 kg = 2.5 lb for dumbbells).',
    `Write every weight in prose ("progression", "rationale", "reply") in ${input.units === 'kg' ? 'kg' : 'pounds (lb), never kg'}. ` +
      'Only the weightKg JSON fields are in kg.',
    '"progression" = one or two sentences on how load/reps move week to week.',
    'Honor equipment, exercises to avoid and injury notes strictly. Honor stated likes/dislikes.',
    '"rationale" = 2-3 sentences citing their actual numbers. "reply" = a short, direct chat reply ' +
      '(1-3 sentences) to what they asked, addressed to them.',
  ];
  if (input.currentPlan) {
    lines.push(
      `Their CURRENT program (JSON): ${JSON.stringify(input.currentPlan)}`,
      'If they ask for a brand-new program, design one from scratch. If they ask to change ' +
        'something, revise the current program: change only what the request requires and keep ' +
        'everything else identical, then say what changed in "reply". If they only ask a ' +
        'question, return the current program unchanged and answer it in "reply".'
    );
  }
  lines.push(`Output ONLY minified JSON of this shape: ${schema}`);
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
    return send(res, 200, { ok: true });
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
