# strengthmaxxing

A self-hosted strength-training system: log workouts, count reps on your watch,
and get an AI coach that auto-progresses your lifts based on how recovered you
are. Data stays yours (SQLite you own) and flows both ways with your health
tracking and Apple Fitness.

## The four parts

| Part | Path | What it is |
| --- | --- | --- |
| **Web + API** | [`web/`](web/) | SvelteKit app (adapter-node). Serves the dashboard **and** the JSON API at `/api/*`. Owns the SQLite database. |
| **Coach agent** | [`agent/`](agent/) | Node service (port 8787) that calls Claude to build training plans and suggest per-session weight/rep adjustments. |
| **iOS + watchOS** | [`ios/`](ios/) | Native app. The watch counts reps (CoreMotion), runs rest timers with haptics, and writes finished workouts to Apple Fitness / HealthKit. |
| **Deploy** | [`deploy/`](deploy/) | Docker Compose + Coolify guide to run web + agent together. |

The integration contract every part agrees on is in
[`API_CONTRACT.md`](API_CONTRACT.md) — read it before touching any service.

## Features

- **Workouts, supersets, and rest timers** — build workout templates with target
  sets/reps/weight; exercises sharing a `supersetGroup` are cycled without rest.
- **Watch rep-counting + fatigue timing** — the watch counts each rep via
  CoreMotion and posts per-rep timing (`offsetMs`, concentric duration) so the
  app can measure rep-to-rep fatigue within a set.
- **Readiness-based coach auto-progression** — the coach reads your recovery
  (sleep, HRV, soreness, calorie balance) and the last weights you hit, then
  suggests the next session's loads (progress, hold, or back off).
- **Calorie estimation** — sessions compute estimated kcal from exercise METs,
  bodyweight, tonnage, and duration.
- **Healthmaxxing export/import** — push recovery data in
  (`PUT /api/readiness/:date`) and pull enriched session history out
  (`GET /api/export`) to sync with your health dashboard.
- **Apple Fitness write** — on finish, the app writes an `HKWorkout` to
  HealthKit using the `/healthkit` payload.

## Local dev quickstart

The web app is the thing you run day to day:

```sh
cd web
pnpm install     # pnpm 11; builds native better-sqlite3 (needs python3/make/g++)
pnpm dev         # http://localhost:5173, SQLite at ./local.db (migrations auto-run)
```

`API_TOKEN` unset in dev leaves `/api/*` open. To exercise the coach locally,
run the agent (`cd agent`) and set `AGENT_URL=http://localhost:8787`.

Want realistic sample history (12 backdated sessions, 3 templates, readiness data)
to see History/Reports populated? Run:

```sh
cd web && node --experimental-strip-types scripts/demo-seed.mjs
```

## Deploy

See [`deploy/README.md`](deploy/README.md) for the Coolify / Docker Compose
guide (persistent volume for the DB, secrets, wiring the agent's Claude auth,
and pointing the app at your deployed URL + token).
