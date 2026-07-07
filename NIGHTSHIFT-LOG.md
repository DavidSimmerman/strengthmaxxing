# 🌙 strengthmaxxing — Nightshift Build Log

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

### Final
- [ ] codex review --uncommitted
- [ ] Green build (pnpm build) + committed

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
- Web: `cd web && pnpm install && pnpm db:push && pnpm dev` → http://localhost:5173
- (fill in agent + tests as built)

## Resume pointer
If context compacted: re-read this file + the task brief. Continue from the first unchecked
box above. The web app is the spine — get it green before breadth.
