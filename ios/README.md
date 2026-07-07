# StrengthMaxxing — Apple client (iOS + watchOS)

Native SwiftUI client for the **strengthmaxxing** web JSON API. The iPhone app browses
workout templates, runs sessions, shows history, and writes finished workouts to Apple
Health. The **watchOS app is the headline**: it auto-counts reps from CoreMotion, runs a
rest timer with a looping haptic "alarm", and captures a live HKWorkoutSession (heart
rate + Activity rings), posting every set to the API in real time.

> Built on Linux with no Xcode, so it has **not been compiled**. Treat this as
> production-quality source that needs an Xcode project wrapped around it. The steps below
> get you from these files to a running app; expect a few minutes of project wiring, not a
> rewrite. Assumptions you must verify are flagged with ⚠️.

---

## File tree

```
ios/
├─ Package.swift                      # OPTIONAL SwiftPM package for the shared core + tests
├─ README.md                          # this file
├─ StrengthMaxxing/                   # SHARED code (both targets)
│  ├─ Models/Models.swift             # Decodable structs matching API_CONTRACT.md exactly
│  ├─ Models/WorkoutPlan.swift        # superset-aware slot planner (used by iOS + watch)
│  ├─ Networking/APIClient.swift      # async/await URLSession client (base URL + bearer)
│  ├─ Settings/AppSettings.swift      # server URL (UserDefaults) + token (Keychain)
│  └─ Health/HealthKitManager.swift   # HK auth + phone-side HKWorkoutBuilder write
├─ StrengthMaxxing iOS/               # iPhone app (SwiftUI)
│  ├─ StrengthMaxxingApp.swift        # @main
│  ├─ Views/RootTabView.swift         # Workouts / History / Settings tabs
│  ├─ Views/WorkoutsListView.swift    # GET /api/workouts, POST /api/sessions
│  ├─ Views/SessionActiveView.swift   # log sets, POST /sets, finish + HealthKit write
│  ├─ Views/HistoryView.swift         # GET /api/sessions[/:id]
│  ├─ Views/SettingsView.swift        # server URL + token + Health status
│  └─ Supporting/
│     ├─ Info-iOS.plist               # Health usage strings + workout-processing bg mode
│     └─ StrengthMaxxing-iOS.entitlements
├─ StrengthMaxxing Watch App/         # watchOS app (SwiftUI)
│  ├─ StrengthMaxxingWatchApp.swift   # @main
│  ├─ Motion/RepCounter.swift         # PURE adaptive peak-detection rep counter
│  ├─ Motion/MotionRepSession.swift   # CMMotionManager device-motion → RepCounter
│  ├─ Session/RestTimer.swift         # countdown + looping .notification haptics
│  ├─ Session/WatchWorkoutSession.swift # HKWorkoutSession + HKLiveWorkoutBuilder (HR/energy)
│  ├─ Session/WorkoutSessionViewModel.swift # orchestrator (supersets, posting, finish)
│  ├─ Views/WatchRootView.swift       # pick a workout / settings
│  ├─ Views/ActiveSessionView.swift   # lifting → review → rest(alarm) → done
│  ├─ Views/WatchSettingsView.swift   # server URL + token on the watch
│  └─ Supporting/
│     ├─ Info-Watch.plist             # Motion + Health strings + WKBackgroundModes
│     └─ StrengthMaxxing-Watch.entitlements
└─ Tests/StrengthMaxxingTests/
   └─ RepCounterTests.swift           # deterministic tests for the rep detector
```

---

## Creating the Xcode project

There's no `.xcodeproj` here (they don't merge well and can't be authored on Linux). Create
one, then add the sources:

1. **New project** → *iOS* → **App**. Product name `StrengthMaxxing`, interface **SwiftUI**,
   language **Swift**. This becomes the **StrengthMaxxing iOS** target.
2. **Add a Watch target**: *File ▸ New ▸ Target… ▸ watchOS ▸ App*. Name it so its folder is
   `StrengthMaxxing Watch App`. Choose "Watch App for iOS App" so it's paired to the phone
   app. (A standalone watch app also works since the watch talks to the API directly.)
3. **Add the source files**: drag the folders above into the project navigator.
   - Add everything under `StrengthMaxxing/` (the shared folder) to **both** targets
     (check both boxes in the "Add to targets" panel). These files have no per-platform
     imports except `HealthKitManager.swift`, which is HealthKit-only and fine on both.
   - Add `StrengthMaxxing iOS/**` to the **iOS** target only.
   - Add `StrengthMaxxing Watch App/**` to the **Watch App** target only.
   - Add `Tests/StrengthMaxxingTests/RepCounterTests.swift` **and**
     `StrengthMaxxing Watch App/Motion/RepCounter.swift` to a **Unit Test** target
     (create one if the template didn't). In the Xcode single-module test target you do
     **not** need the `SM_SPM_TESTS` flag — that flag is only for the SwiftPM path below.
4. **Delete the template's** `ContentView.swift` / stub `@main` files so there's one `@main`
   per target (`StrengthMaxxingApp` for iOS, `StrengthMaxxing_Watch_AppApp` for watch).

### Or: run the pure tests without the app

The shared core + rep counter can be tested from the command line on a Mac:

```bash
cd ios
swift test        # builds StrengthMaxxing + runs RepCounterTests via Package.swift
```

`Package.swift` intentionally includes only the platform-agnostic files so it compiles on
macOS. The app/watch/HealthKit/CoreMotion code stays in the Xcode targets.

---

## Required capabilities

Enable under **Signing & Capabilities** for the noted target(s):

| Capability | iOS target | Watch target | Why |
|---|---|---|---|
| **HealthKit** | ✅ | ✅ | write HKWorkout, read HR/energy |
| **Background Modes → Workout processing** | ✅ | ✅ | keep the live workout session alive |
| **App Groups** (optional) | ◻︎ | ◻︎ | only if you want to share the token/defaults phone↔watch |

The `Info-*.plist` and `*.entitlements` files list the exact keys. If you use Xcode's
generated Info.plist, copy the usage strings (`NSMotionUsageDescription`,
`NSHealthShareUsageDescription`, `NSHealthUpdateUsageDescription`) into
*Target ▸ Info ▸ Custom … Target Properties* and set the background modes there.

**Missing usage strings crash the app** the moment it asks for Motion/Health — don't skip
them.

---

## Pointing the app at your server

Open **Settings** in either app and enter:

- **Server URL** — the base URL of your web app, e.g. `http://192.168.1.20:3000` on your
  LAN or `https://strength.example.com` in prod. (Default is `http://localhost:3000`,
  which only works in the simulator.)
- **API token** — paste your `API_TOKEN`. Required **only if** the server has `API_TOKEN`
  set; leave blank for an open dev server. Stored in the Keychain, sent as
  `Authorization: Bearer <token>`.

Tap **Test connection** to verify (it calls `GET /api/exercises`).

⚠️ **App Transport Security**: plain `http://` is allowed to local addresses via
`NSAllowsLocalNetworking`. For a plain-HTTP **remote** dev server, add its host under
`NSExceptionDomains` (commented example in `Info-iOS.plist`) or serve over HTTPS.

The **watch enters its own URL/token** (see below), so set it there too.

---

## Watch ↔ phone: how the watch reaches the API

**Chosen approach: the watch talks to the JSON API directly** (allowed by the contract and
simpler than a WatchConnectivity relay). The watch runs the same `APIClient` and posts each
set / starts / finishes sessions itself, so rep timing is captured with no round-trip to the
phone.

Consequence: **the watch keeps its own server URL + token**, entered once in the watch's
Settings screen. That's the only "setup tax" of the direct model.

⚠️ **WatchConnectivity note**: if you'd rather enter the token once on the phone and push it
to the watch, add `WCSession` and send `["baseURL":…, "token":…]` via
`transferUserInfo`/`updateApplicationContext`, then write it into `AppSettings` on the
watch. The code is structured for this (single `AppSettings` type) but the WCSession glue is
intentionally **not** included to keep the direct model clean. Alternatively, share via an
**App Group** (uncomment the group in both `.entitlements` and it's already the `suiteName`
in `AppSettings`) — but note the Keychain token is **not** shared by an App Group unless you
also set a Keychain access group.

---

## How the headline features work

- **Auto rep counting** — `MotionRepSession` samples `CMMotionManager` device-motion at
  50 Hz and feeds `|userAcceleration|` into `RepCounter`, a pure adaptive peak detector:
  EMA-smoothed signal, adaptive threshold = `baseline + k·deviation`, one rep per
  acceleration burst (peak), with a refractory period to prevent double-counts. Each rep's
  `offsetMs` (from the first rep) and estimated `concentricMs` are recorded and posted in
  `repEvents`. Tune `RepCounterConfig` and re-run `RepCounterTests` to validate.
- **Rest alarm** — `RestTimer` counts down `restSec` from an absolute fire date, then flips
  to `.alarming` and fires `WKInterfaceDevice.current().play(.notification)` on a repeating
  1.2s timer until the user taps **Stop**.
- **Live workout / rings** — `WatchWorkoutSession` runs an `HKWorkoutSession` +
  `HKLiveWorkoutBuilder` (`.traditionalStrengthTraining`) for the whole session, surfacing
  live heart rate and finalizing/saving the HKWorkout on finish.
- **Supersets** — `WorkoutPlanner.buildSlots` (shared) expands the template so exercises
  sharing a `supersetGroup` are cycled with **no rest between members**; the rest timer runs
  only after the **last** member of each round. Both iPhone and watch use it, so they walk a
  workout identically.
- **HealthKit on the phone** — when a session is finished on the iPhone,
  `HealthKitManager.saveStrengthWorkout` builds an `HKWorkout` via `HKWorkoutBuilder` using
  the finish response's `estimatedKcal` as `totalEnergyBurned`, plus metadata (session id,
  template name, total volume). On the watch, the live builder already saves the workout, so
  the phone write is the finish-on-phone path.

---

## Assumptions to verify in Xcode (⚠️)

1. **Bundle IDs / App Group / Keychain service.** Defaults assumed:
   `tech.simmerman.strengthmaxxing` (iOS) and `…strengthmaxxing.watchkitapp` (watch),
   App Group `group.tech.simmerman.strengthmaxxing`, Keychain service
   `tech.simmerman.strengthmaxxing`. Change these to your team's identifiers — the Keychain
   `service` string in `AppSettings.swift` just needs to be stable, and the App Group is
   only used if you enable it.
2. **HealthKit payload shape.** `GET /api/sessions/:id/healthkit` is decoded defensively
   (`HealthKitPayload`) but the client currently builds the HKWorkout from the **finished
   session** (energy = `estimatedKcal`, dates from `startedAt`/`completedAt`), which is
   fully specified. If you prefer the server payload, confirm its exact fields and switch
   `saveStrengthWorkout(for:…)` to consume `getHealthKitPayload`.
3. **`repEvents` element shape.** Sent exactly as
   `{repIndex, offsetMs, concentricMs?}` per the contract. The watch supplies real per-rep
   timing; the phone supplies evenly-spaced synthetic offsets (2s apart) since it has no
   motion signal — verify the server accepts `concentricMs` being absent (it's optional in
   the contract). Also confirm optional decode fields (e.g. session `sets`) match your real
   responses; unknown extra keys are ignored, missing optionals default to `nil`.
```
