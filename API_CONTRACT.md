# strengthmaxxing — integration contract (authoritative)

All services agree on the shapes here. Do not deviate.

## Web app (SvelteKit, adapter-node)
- Serves BOTH the dashboard (HTML) and the JSON API (`/api/*`).
- Prod: `node build` (port 3000). Dev: `pnpm dev` port 5173.
- SQLite at `DB_PATH` (default `local.db`). Migrations run on boot (hooks.server.ts).
- Shared server logic lives in `src/lib/server/repo.ts` — **API endpoints and dashboard
  actions both call repo functions.** Never re-implement rollups/export math.
- Metrics (pure) in `src/lib/metrics.ts`: `e1rm`, `tonnage`, `repFatigue`, `estimateKcal`,
  `readinessScore`, `loadMultiplier`.

## Auth
`/api/*` requires `Authorization: Bearer $API_TOKEN` **only when `API_TOKEN` is set** (unset in
dev = open). Dashboard pages use server load/actions (direct DB) and need no token.

## Units
Weights in **kg** everywhere in the DB/API. UI may show lb (convert at the edge). Timestamps in
API responses are ISO strings (Drizzle `Date`). Client-supplied timestamps (`startedAt`,
`completedAt`, rep `offsetMs`) are epoch **ms**.

---

## JSON API (`web/src/routes/api/**`) — owned by API agent

### Exercises
- `GET /api/exercises` → `Exercise[]` `{id,name,muscle,category,met,isBodyweight,defaultRestSec}`

### Workout templates
- `GET /api/workouts` → `Workout[]` with nested `exercises` (each has `.exercise` joined)
- `POST /api/workouts` body:
  ```json
  {"name":"Push A","notes":"","exercises":[
    {"exerciseId":5,"orderIndex":0,"supersetGroup":null,"targetSets":3,"targetReps":8,"targetWeightKg":60,"restSec":150}]}
  ```
  → created workout. (supersetGroup: shared int = superset. `perSide: true` = one arm / leg at a
  time: each set is left then right, `targetReps` per side, `restSec` after both sides.)
- `GET /api/workouts/:id` → workout | 404
- `PATCH /api/workouts/:id` body: any of `{name,notes,archived,exercises}` (exercises = full replace)
- `DELETE /api/workouts/:id` → soft-archive

### Sessions (performed workouts)
- `POST /api/sessions` body `{workoutId?,name?,source?,bodyweightKg?,readinessScore?}` → `{id,...}` (starts it)
- `GET /api/sessions?limit=30` → session summaries (newest first)
- `GET /api/sessions/:id` → session with nested `sets` (each `.exercise`, `.reps`)
- `POST /api/sessions/:id/sets` body (this is what the **watch** posts per completed set):
  ```json
  {"exerciseId":5,"setIndex":0,"supersetGroup":null,"reps":8,"weightKg":60,"rpe":8,
   "isWarmup":false,"restSecActual":null,"startedAt":1720000000000,"completedAt":1720000030000,
   "repEvents":[{"repIndex":0,"offsetMs":0},{"repIndex":1,"offsetMs":1800,"concentricMs":900}]}
  ```
  → created set. Optional `"side":"L"|"R"` for one-side exercises (a pair shares `setIndex`).
  `restSecActual` = rest before THIS set. If `startedAt` is missing the server estimates it
  (reps × seconds per rep, learned from earlier rep events, + setup) and computes
  `restSecActual` from the previous set's `completedAt`.
- `POST /api/sessions/:id/finish` body `{notes?,bodyweightKg?}` → finalized session (computes
  `totalVolumeKg` + `estimatedKcal`); response also good to hand to iOS for HealthKit.
- `DELETE /api/sessions/:id`

### Readiness (healthmaxxing pushes recovery data IN)
- `GET /api/readiness/:date` (date = `YYYY-MM-DD`) → readiness row | null
- `PUT /api/readiness/:date` body `{sleepHours?,kcalBalance?,proteinG?,sorenessNote?,sorenessLevel?,hrvMs?,hrvBaselineMs?,restingHr?,restingHrBaseline?}`
  → upserts + computes `score`

### Export (healthmaxxing pulls OUT)
- `GET /api/export?since=<ISO>` → `{app,exportedAt,sessions:[ sessionExport ]}` (use `repo.fullExport`)
- `GET /api/sessions/:id/export` → single `sessionExport` (enriched: per-set fatigue, e1rm, volumeByMuscle)
- `GET /api/sessions/:id/healthkit` → HKWorkout payload (`repo.healthkitPayload`)

### Coach (proxies to the agent service at `AGENT_URL`, default `http://localhost:8787`)
- `POST /api/coach/plan` body `{goal,daysPerWeek,experience,equipment?,constraints?}` →
  forwards to agent `POST /plan`, returns its JSON. On agent error return 502 `{error}`.
- `POST /api/coach/progress` body `{workoutId,date?}` → the endpoint assembles context from the
  DB (the workout's exercises + last performed weights via repo, latest `readiness` row, current
  hour) and forwards to agent `POST /progress`; returns its JSON.
- `POST /api/coach/today` body `{energy?:1-5, minutes:10-240, soreness?:{[muscle]:0|1|2}}` →
  today's generated session from the engine in `web/src/lib/coach` (no model call; instant).
  Muscles: chest, frontDelts, sideDelts, rearDelts, lats, upperBack, biceps, triceps, abs,
  obliques, quads, hamstrings, glutes, calves.
- `POST /api/coach/today/review` body `{plan}` (a SessionPlan from `/today`) → the plan after the
  agent's `POST /review` (same-muscle swaps from an allowed list, reasons, summary). 502 when the
  agent fails; the caller keeps the engine's plan.

Every endpoint: validate input (400 on bad body), JSON errors `{error:string}`, never throw raw.

---

## Coach agent service (`agent/**`) — owned by agent agent
Node service, port **8787**. Uses the **personal Claude subscription via the `claude` CLI**
(`claude -p "<prompt>" --output-format json`), with an `ANTHROPIC_API_KEY` fallback if set.
Return STRICT JSON (ask the model for JSON, parse defensively, 502 on parse fail).

- `GET /health` → `{ok:true}`
- `POST /plan` body `{goal,daysPerWeek,experience,equipment?,constraints?,history?}` →
  ```json
  {"plan":{"name":"...","days":[{"name":"Push A","exercises":[
     {"name":"Bench Press","sets":3,"reps":8,"restSec":150,"notes":""}]}]},"rationale":"..."}
  ```
- `POST /progress` body `{workout:{name,exercises:[{name,lastWeightKg,lastReps,targetReps}]},
   readiness:0-100, context:{timeOfDay,kcalBalance,sleepHours,sorenessNote}}` →
  ```json
  {"adjustments":[{"name":"Bench Press","suggestedWeightKg":62.5,"suggestedReps":8,
    "deltaPct":4,"reason":"readiness high, +progression"}],"summary":"..."}
  ```
Exercise names in `/progress` output must match input names so the app can map them back.
- `POST /review` body `{plan:{exercises:[{name,forMuscle,sets,reps,weightLb,engineReason,…}]},
   alternatives:{[name]:[name]}, checkIn, profile}` →
  `{"summary":"...","items":[{"name":"...","swapTo":null,"reason":"..."}]}`. `swapTo` must come
  from `alternatives[name]`; the web side re-prescribes swapped exercises and ignores anything else.

---

## iOS + watchOS (`ios/**`) — owned by iOS agent
Native app talks to the web JSON API. Base URL + bearer token in app settings.
- Watch counts reps via CoreMotion, posts each completed set to `POST /api/sessions/:id/sets`
  with `repEvents` (offsetMs per rep).
- Rest timer: after a set, watch runs a countdown = `restSec`; on expiry fires **repeating**
  haptics (`WKInterfaceDevice.play(.notification)` looped) until the user taps Stop.
- On finish: `POST /api/sessions/:id/finish`, then write an `HKWorkout` to HealthKit (Apple
  Fitness) using the `/healthkit` payload shape (or build locally from the session).
- Supersets: exercises with the same `supersetGroup` are cycled without rest between them.
- One-side exercises: the watch does its own wrist's side first (counted), then the other side
  (not counted: timer + Done), no rest between sides.
- iPhone app rest alarm: the page asks the shell (`restAlarm {endsAt}` / `restAlarmCancel`); iOS 26+
  rings an AlarmKit alarm until dismissed, older iOS a burst of notifications.

---

## v2 additions (Oct 2026) — authoritative for web + iOS

### Auth
- `/api/*` accepts `Authorization: Bearer $API_TOKEN` **or** a valid dashboard session cookie
  (`smx_session`, set by `POST /login` with `DASHBOARD_PASSWORD`, falling back to `API_TOKEN`).
- Dashboard pages require the cookie whenever a password/token is configured. `/login` and
  `/healthz` are always public.

### Settings (shared by dashboard, phone, watch)
- `GET /api/settings` → `{units:"lb"|"kg", voiceCount:boolean, restAlarmSnoozeSec:number}`
  (defaults: `lb`, `true`, `60`). `PATCH /api/settings` with any subset.
- Storage + math stay in **kg**. Clients convert at display time. lb display rounds to 0.5 lb
  for stored values (`kg / 0.45359237`), weight steppers step 5 lb (barbell/machine/cable) or
  2.5 lb (dumbbell), kg mode keeps 2.5 / 2 / 1.

### Idempotent, offline-friendly writes
- `POST /api/sessions` accepts optional `clientId` (UUID string) and `startedAt` (epoch ms).
  If a session with that `clientId` exists, it is returned with **200** (not a duplicate 201).
- `POST /api/sessions/:id/sets` accepts optional `clientId` (UUID). Same-clientId repeat → 200
  with the existing set. Sets **are accepted after finish** — the server recomputes the
  session's rollups (volume / kcal) whenever a set is added, edited or deleted post-finish.
- `reps` must be ≥ 1. Clients treat a 0-rep set as "skipped" and do not post it.
- `rpe` is optional; clients send `null` unless the user actually set it.

### Edit / delete a logged set
- `PATCH /api/sessions/:id/sets/:setId` body any of `{reps, weightKg, rpe, isWarmup}` → set
- `DELETE /api/sessions/:id/sets/:setId` → 204

### Exercises
- `POST /api/exercises` body `{name, muscle, category, isBodyweight?, defaultRestSec?, met?}` →
  201 custom exercise (409 if name exists).
- `GET /api/exercises/:id/history` → `{exercise, sets:[{date,sessionId,reps,weightKg,e1rm}], prs}`

### Rep-counter calibration (watch learns per exercise)
The watch owns the algorithm; the server stores an opaque JSON blob per exercise so learning
survives reinstalls and is shared across watches.
- `GET /api/calibration` → `[{exerciseId, params:object, samples:number, updatedAt}]`
- `PUT /api/calibration/:exerciseId` body `{params:object, samples:number}` → row

### Raw motion traces (for offline tuning of the counter)
- `POST /api/motion-traces` body
  `{exerciseId, setClientId?, sampleHz, detectedReps, actualReps, params?, samples:[[tMs,ax,ay,az,gx,gy,gz,rx,ry,rz],...]}`
  (`a*` = userAcceleration g, `g*` = gravity unit vector, `r*` = rotationRate rad/s) → 201 `{id}`.
  Body limit 4 MB. `GET /api/motion-traces?exerciseId=` lists metadata (no samples).

### Coach v2 (web → agent)
- `GET /api/coach/profile` → `{profile, activeProgram, week}`; `PUT /api/coach/profile` body
  `{goal?, daysPerWeek?, sessionMin?, experience?, equipment?:string[], avoid?, notes?}`.
- `POST /api/coach/plan` body `{request?, profile?, revise?}` — the web adds `units`, `history`
  (per-exercise best e1RM + last top set) and `library` (exact exercise names) and forwards to
  agent `POST /plan`. `revise:true` sends the active program as `currentPlan` to edit.
  → `{plan:{name,weeks,deloadWeek,progression,days:[{name,dayOfWeek,exercises:[{name,exerciseId,sets,reps,restSec,weightKg,notes}]}]},rationale,reply}`
- `POST /api/coach/program` body `{plan}` → saves each day as a workout template, retires the
  previous program's templates, stores it as `activeProgram`. 201.
- `POST /api/coach/progress` now bases each exercise on the **top set** (best e1RM) of its last
  session. `POST /api/coach/progress/apply` body `{workoutId, adjustments}` writes accepted
  suggestions into the template's `targetWeightKg` / `targetReps`.

### Calories (v2.1)
- `POST /api/sessions/:id/finish` also takes `activeKcal` (0-5000), `avgHr` (30-250) and
  `kcalSource` (`apple_watch` | `heart_rate`). When present they replace the server's MET
  estimate. Sending them again after finish updates only the calories, so the watch can
  report Apple's number after the Apple workout saves.
- Sessions carry `kcalSource` (`apple_watch` | `heart_rate` | `estimate`) and `avgHr`.
  `estimatedKcal` is **active** kcal (above resting), same meaning as Apple's Active Calories.
  Measured values are never overwritten when sets change later; the estimate is recomputed.
