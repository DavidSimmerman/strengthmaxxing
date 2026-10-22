# strengthmaxxing — coach agent service

A tiny Node service (Node 22, ESM, **stdlib only** — no web framework) that generates
workout programs and autoregulates progression using the model. It is the backend for the
web app's `/api/coach/*` endpoints (which proxy here). Contract: see `../API_CONTRACT.md`
→ "Coach agent service".

## How it authenticates (two backends, auto-selected)

1. **`claude` CLI (default — personal Claude subscription).** The service shells out to
   `claude -p --output-format json` (prompt on stdin) and reads the model's reply from the
   `result` field of the CLI's JSON envelope. This uses the user's own Claude subscription —
   no API key needed. In Docker, the CLI is installed globally and you mount the user's
   `~/.claude` credentials dir (see Dockerfile).
2. **Anthropic API (fallback).** If the CLI isn't available (or a CLI call fails) **and**
   `ANTHROPIC_API_KEY` is set, it calls the Anthropic Messages API with model `AGENT_MODEL`.

If neither backend works, model endpoints return **502 `{error}`**.

## Endpoints

| Method | Path        | Body                                                             | Response |
|--------|-------------|-----------------------------------------------------------------|----------|
| GET    | `/health`   | —                                                               | `{ok:true}` |
| POST   | `/plan`     | `{goal,daysPerWeek,experience,equipment?,constraints?,history?}` | `{plan:{name,days:[{name,exercises:[{name,sets,reps,restSec,notes}]}]},rationale}` |
| POST   | `/progress` | `{workout:{name,exercises:[{name,lastWeightKg,lastReps,targetReps}]},readiness,context:{timeOfDay,kcalBalance,sleepHours,sorenessNote}}` | `{adjustments:[{name,suggestedWeightKg,suggestedReps,deltaPct,reason}],summary}` |

The model is prompted to return **strict minified JSON** matching the shape above; the
service strips accidental ```json fences and `JSON.parse`s defensively, returning
`502 {error:"bad model output"}` on parse failure. In `/progress`, output exercise `name`s
match the input names so the app can map results back.

## Environment variables

| Var                 | Default              | Purpose |
|---------------------|----------------------|---------|
| `PORT`              | `8787`               | Listen port. |
| `AGENT_MODEL`       | `claude-opus-5-5`    | Model id (passed to the CLI as `--model` and used by the API fallback). |
| `AGENT_RESEARCH`    | `on`                 | `/plan` may use web search + page reading first and returns `sources`. `off` disables. |
| `AGENT_EFFORT`      | `medium`             | How hard the model thinks (`low`…`max`). Passed as `--effort` / `output_config.effort`. |
| `ANTHROPIC_API_KEY` | *(unset)*            | Enables the API fallback when set. |
| `CLAUDE_BIN`        | `claude`             | Path/name of the CLI binary. |
| `AGENT_TIMEOUT_MS`  | `240000`             | Timeout per model call. |

## Run locally

```bash
node server.js            # or: npm start
```

## Test with curl

```bash
# health
curl -s localhost:8787/health
# -> {"ok":true}

# plan (model call can take ~10-30s; give curl a generous timeout)
curl -s --max-time 120 -X POST localhost:8787/plan \
  -H 'content-type: application/json' \
  -d '{"goal":"hypertrophy","daysPerWeek":3,"experience":"intermediate",
       "equipment":["barbell","dumbbells"],"constraints":"bad left knee"}'

# progress
curl -s --max-time 120 -X POST localhost:8787/progress \
  -H 'content-type: application/json' \
  -d '{"workout":{"name":"Push A","exercises":[
        {"name":"Bench Press","lastWeightKg":60,"lastReps":8,"targetReps":8}]},
       "readiness":82,
       "context":{"timeOfDay":"morning","kcalBalance":-300,"sleepHours":7.5,"sorenessNote":"none"}}'
```

## Docker

```bash
docker build -t coach-agent ./agent
# CLI auth: mount your ~/.claude credentials
docker run -p 8787:8787 -v ~/.claude:/root/.claude coach-agent
# or API auth:
docker run -p 8787:8787 -e ANTHROPIC_API_KEY=sk-ant-... coach-agent
```
