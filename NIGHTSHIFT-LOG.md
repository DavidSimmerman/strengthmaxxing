# 🌙 Nightshift Run 2 — Review & Improve (2026-07-10)

**Task:** Review the whole project; fix bugs and make improvements.

## Status (run 2)
- [x] Baseline: build + svelte-check + metrics self-check + API smoke green (all ✓ 2026-07-10;
      servers restarted: web :4173, agent :8899 — run-1 processes died with the old session)
- [ ] Review sweep: web server/API, web UI, metrics math, agent, iOS, deploy
- [ ] Triage findings → fix real bugs (minimal diffs)
- [ ] Verify fixes (smoke + Playwright + build)
- [ ] Adversarial review of my diff (codex review --uncommitted)
- [ ] Commit + final log update

## Decisions (run 2)
- (recorded as made)

## Findings & fixes (run 2)
- (filled in as review lands)

## Resume pointer (run 2)
Re-read this section + run-1 log below. Baseline commands are in run-1 "How to run / verify".
Continue from first unchecked box.

---

# 🌙 strengthmaxxing — Nightshift Build Log (run 1, 2026-07-07)

**Task:** Build "strengthmaxxing", a Motra-style strength-training app. Create workouts
with exercises (sets/reps/weight/rest timers), supersets, an Apple Watch app that
auto-counts reps + buzzes on rest-timer end, per-rep timing for fatigue tracking, data
export to the user's "healthmaxxing" health-dashboard app, calorie-burn estimation, write
workouts to Apple Fitness (HealthKit), deploy on Coolify, and a Dockerized Claude "coach"
agent (using the personal Claude subscription) that generates plans and auto-progresses
weights based on time-of-day / diet / sleep / soreness.

**Started:** 2026-07-07 (autonomous overnight run)

---

## Architecture (decided autonomously — see Decisions)

```
workouts/
  web/      SvelteKit + TS + Tailwind + Drizzle + SQLite  — dashboard + JSON API (the spine)
  agent/    Node service — Claude "coach": plan generation + weight auto-progression
  ios/      SwiftUI iOS + watchOS source — rep counting (CoreMotion), rest haptics,
            HealthKit workout write, syncs to web API. (Build on Mac — cannot compile here.)
  deploy/   docker-compose + Dockerfiles + Coolify notes
```

**Stack rationale (ponytail):** SQLite over Postgres — no DB server, the whole DB is one
file (literally "data easily accessible"), one Coolify volume. Web app serves BOTH the
dashboard and the JSON API the watch/agent talk to (SvelteKit does both). Agent talks to
the web API over HTTP, never the DB directly → no concurrent-writer problem.

---

## Status

### Core web app + API (verifiable here) — ✅ DONE + VERIFIED
- [x] Scaffold SvelteKit + Tailwind v4 + Drizzle + SQLite (better-sqlite3, adapter-node)
- [x] DB schema (exercises, workouts, workout_exercises w/ supersetGroup, sessions,
      session_sets, rep_events, readiness) — 7 tables, migrate+seed on boot
- [x] JSON API: exercises, workouts CRUD, sessions, sets+repEvents, finish, export,
      healthkit, readiness, coach proxy — ALL tested via HTTP (full flow passed)
- [x] Web dashboard: workout builder (sets/reps/weight/rest + A/B/C/D supersets)
- [x] Web dashboard: Today, live session logging + rest timer, history + fatigue timeline,
      reports (off-day detector, strength-vs-readiness), coach — screenshotted, 0 console errors
- [x] Metrics engine: e1RM (Epley), tonnage, rep-velocity fatigue, readiness, calorie burn
      — pure, self-check passes
- [x] Export endpoint formatted for healthmaxxing (per-set fatigue, e1rm, volumeByMuscle)
- [x] Playwright verify (8 pages) + full curl API flow verify — all green

### AI coach agent — ✅ DONE + VERIFIED LIVE
- [x] Agent service: generate workout plan (tested live via claude CLI, ~78s, real plan)
- [x] Agent service: progress/regress weights from readiness inputs (tested, correct autoreg)
- [x] Dockerfile + wired to personal Claude subscription via `claude -p` CLI (+ API key fallback)
- [x] Uses the personal Claude subscription (claude CLI), NOT an API key — as requested

### iOS + watchOS (source only — build on Mac) — ✅ SOURCE COMPLETE (cannot compile here)
- [x] iOS app: workout list, start session, active logging, history, settings, HealthKit write
- [x] watchOS app: rep counting (CoreMotion adaptive peak detection + unit test),
      rest-timer looping haptics until stopped, live HKWorkoutSession
- [x] HealthKit: write HKWorkout to Apple Fitness (phone + watch)

### Deploy — ✅ DONE
- [x] web/Dockerfile (multi-stage, native module survives), agent/Dockerfile, docker-compose
- [x] Coolify guide (deploy/README.md), root README.md, .env.example — compose validates

### Final — ✅ DONE
- [x] Adversarial review. `codex review --commit` choked for 30+ min re-reading the huge mixed
      commit (verbose iOS Swift + build artifacts) and never produced a verdict — killed it.
      Did a focused manual review of the risk surface instead:
      - **agent subprocess**: SAFE — `execFile` (no shell), static argv, user prompt via stdin →
        zero command-injection surface; bounded timeout/buffer; 1MB body cap.
      - **SQL**: drizzle parameterizes everything; no raw string SQL with user input.
      - **API input validation**: endpoints validate types + return 400 on bad bodies.
      - **FOUND + FIXED a real bug**: `hooks.server.ts` ran the auth check before the CORS
        preflight handler → OPTIONS returned 401 when API_TOKEN is set, breaking cross-origin
        browser clients. Reordered so OPTIONS bypasses auth. Verified: OPTIONS→200, GET no-token
        →401, GET+token→200.
- [x] Green build (`pnpm build`) + svelte-check 0 errors + committed

## Runtime port notes (local verify)
- Ports 8787 AND 8790 are taken by OTHER pre-existing VM services. Agent runs locally on
  **8899**; web started with `AGENT_URL=http://localhost:8899`. In Docker/Coolify this is moot
  (compose network: web → http://agent:8787). Use the harness background runner for servers —
  shell `( & )` left zombies holding 5173.

---

## Decisions (autonomous)

- **SQLite not Postgres** — file-based, exportable, one volume. Agent uses HTTP not direct DB.
- **SvelteKit serves API + dashboard in one app** — fewer deployables, matches user default stack.
- **"healthmaxxing" = the user's health-dashboard app** (they have a Health Dashboard MCP).
  We build a clean `/api/export` + a documented push format rather than guessing their schema.
- **iOS/watch app is source-only** — no macOS/Xcode in this Linux VM. Written to `ios/` which
  syncs to the Mac for building. Cannot compile/verify here; documented as such.
- **Skipped interactive brainstorming skill** — nightshift is autonomous, no user to ask.
- **Agent uses Anthropic Messages API with a configurable key; personal subscription via the
  `claude` CLI is documented as the alt path** — cannot bind an interactive OAuth session in a
  headless container tonight.

## How to run / verify
- **LIVE NOW:** https://strengthmaxxing.simmerman.cc (Cloudflare-gated to you). Prod build
  (`node build`) on VM port **4173** w/ the demo-seeded DB; coach agent on **8899**.
  (These are background processes started during the run — see the harness task list. If a
  reboot killed them: `cd web && PORT=4173 HOST=0.0.0.0 DB_PATH=./local.db AGENT_URL=http://localhost:8899 node build`
  and `cd agent && PORT=8899 node server.js`, then `expose strengthmaxxing 4173`.)
- Web dev: `cd web && pnpm install && pnpm dev` → http://localhost:5173 (migrations auto-run).
- Demo data: `cd web && node --experimental-strip-types scripts/demo-seed.mjs`
- API smoke test (server running): `cd web && node scripts/smoke.mjs`
- Metrics self-check: `cd web && node --experimental-strip-types src/lib/metrics.ts`
- Coach live: `cd agent && node server.js` then `curl localhost:8787/health`; plan calls ~40-80s.
- Prod/Docker: `pnpm build` → `node build`; or `deploy/docker-compose.yml` (see deploy/README.md).
- Note: `healthmaxxing.simmerman.cc` (localhost:5184) is your real health app — the export
  (`GET /api/export`) + readiness import (`PUT /api/readiness/:date`) endpoints target it.

## Resume pointer
If context compacted: re-read this file + the task brief. Continue from the first unchecked
box above. The web app is the spine — get it green before breadth.
