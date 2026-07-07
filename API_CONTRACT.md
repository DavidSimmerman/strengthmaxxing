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
  → created workout. (supersetGroup: shared int = superset.)
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
  → created set
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
