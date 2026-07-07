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

### Core web app + API (verifiable here)
- [ ] Scaffold SvelteKit + Tailwind + Drizzle + SQLite
- [ ] DB schema (exercises library, workouts, workout_exercises, supersets, sessions,
      session_sets, rep_events)
- [ ] JSON API: workouts CRUD, start/log/end session, log rep-events, export
- [ ] Web dashboard: workout builder (sets/reps/weight/rest + supersets)
- [ ] Web dashboard: session history + fatigue/velocity charts + reports
- [ ] Metrics engine: e1RM (Epley), tonnage, rep-velocity fatigue, readiness, calorie burn
- [ ] Export endpoint formatted for healthmaxxing / health-dashboard
- [ ] Playwright verify + curl API verify

### AI coach agent (verifiable here w/ mock, live needs key)
- [ ] Agent service: generate workout plan
- [ ] Agent service: progress/regress weights from readiness inputs
- [ ] Dockerfile + wire to personal Claude subscription (claude CLI / API key)

### iOS + watchOS (source only — build on Mac)
- [ ] iOS app: workout list, start session, sync
- [ ] watchOS app: rep counting (CoreMotion peak detection), rest-timer haptics
- [ ] HealthKit: write HKWorkout to Apple Fitness

### Deploy
- [ ] docker-compose + Dockerfiles for Coolify
- [ ] README / deploy notes

### Final
- [ ] codex review --uncommitted
- [ ] Green build + committed

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
