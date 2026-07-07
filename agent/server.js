// Coach AI agent microservice for "strengthmaxxing".
// Node 22, ESM, stdlib only. Talks to the model via the personal Claude
// subscription through the `claude` CLI (headless/print mode), or falls back
// to the Anthropic Messages API when ANTHROPIC_API_KEY is set.
//
// Contract (see ../API_CONTRACT.md, "Coach agent service"):
//   GET  /health   -> {ok:true}
//   POST /plan     -> {plan:{name,days:[{name,exercises:[{name,sets,reps,restSec,notes}]}]},rationale}
//   POST /progress -> {adjustments:[{name,suggestedWeightKg,suggestedReps,deltaPct,reason}],summary}

import { createServer } from 'node:http';
import { execFile } from 'node:child_process';

const PORT = Number(process.env.PORT) || 8787;
const AGENT_MODEL = process.env.AGENT_MODEL || 'claude-opus-4-8';
const CLI_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL_TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS) || 120_000;

// ---------------------------------------------------------------------------
// Model invocation
// ---------------------------------------------------------------------------

// Is the `claude` CLI usable? Cache the answer after first probe.
let cliAvailable = null;
function probeCli() {
  if (cliAvailable !== null) return Promise.resolve(cliAvailable);
  return new Promise((resolve) => {
    execFile(CLI_BIN, ['--version'], { timeout: 10_000 }, (err) => {
      cliAvailable = !err;
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
      ['-p', '--output-format', 'json'],
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
    },
    body: JSON.stringify({
      model: AGENT_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`anthropic api ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
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
    '{"plan":{"name":string,"days":[{"name":string,"exercises":[{"name":string,"sets":number,"reps":number,"restSec":number,"notes":string}]}]},"rationale":string}';
  return [
    SYSTEM_RULES,
    '',
    'Task: design a workout program.',
    `Inputs (JSON): ${JSON.stringify(input)}`,
    `Produce exactly ${input.daysPerWeek} training days.`,
    'Choose exercises only from the available equipment; respect constraints and injury notes.',
    'Set sets/reps/restSec appropriate to the goal and experience level.',
    `Output ONLY minified JSON of this shape: ${schema}`,
  ].join('\n');
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
    'Base each suggestion on lastWeightKg and lastReps vs targetReps, then modulate by readiness',
    'and context (timeOfDay, kcalBalance deficit, sleepHours, sorenessNote).',
    'deltaPct is the percent change in load vs lastWeightKg (may be negative).',
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
      if (data.length > 1_000_000) reject(new Error('body too large'));
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
  if (typeof b.goal !== 'string' || !b.goal) return 'goal (string) required';
  if (!Number.isFinite(b.daysPerWeek) || b.daysPerWeek < 1 || b.daysPerWeek > 7)
    return 'daysPerWeek (1-7) required';
  if (typeof b.experience !== 'string' || !b.experience) return 'experience (string) required';
  return null;
}

function validateProgress(b) {
  if (!b || typeof b !== 'object') return 'body required';
  if (!b.workout || !Array.isArray(b.workout.exercises)) return 'workout.exercises[] required';
  if (!Number.isFinite(b.readiness)) return 'readiness (number) required';
  return null;
}

async function handleModelEndpoint(res, prompt) {
  let text;
  try {
    text = await askModel(prompt);
  } catch (e) {
    return send(res, 502, { error: `model call failed: ${e.message}` });
  }
  let parsed;
  try {
    parsed = parseModelJson(text);
  } catch {
    return send(res, 502, { error: 'bad model output' });
  }
  return send(res, 200, parsed);
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
