# StrengthMaxxing — iPhone + Apple Watch

SwiftUI client for the strengthmaxxing JSON API. The **watch is the headline**: it
auto-counts reps (and learns from your corrections), speaks the count, runs a real rest
alarm, and works with no network.

## Build & run (Mac, Xcode 26)

```bash
open ios/StrengthMaxxing.xcodeproj
```

1. The project is committed and uses Xcode synchronized folders, so new Swift files appear
   on their own. Only after editing `project.yml` (targets, plist keys, team) run
   `brew upgrade xcodegen && cd ios && xcodegen` (XcodeGen 2.43+) and commit the result.
   `DEVELOPMENT_TEAM` is set there (same team as Mile A Day).
2. Run the **StrengthMaxxing** scheme on your iPhone. Run **StrengthMaxxingWatch** on the
   watch (needs Developer Mode on the watch: Settings > Privacy & Security).
3. In the iPhone app, sign in with the dashboard password, then Settings > **Connect Apple
   Watch** sends the server address + API token to the watch.

## The iPhone app is the web dashboard

`StrengthMaxxing iOS/` is a native shell (`WebShellView`, a WKWebView) on the live site, so
deploying the web app updates the phone app with no rebuild. `NativeBridge` gives the page
what a browser can't: Apple Health (heart-rate calories, saving the workout) and handing
the token to the watch. The web side is `web/src/lib/native.ts`; everything has a plain-web
fallback. Rebuild in Xcode only when native code changes.

## Layout

```
project.yml / Package.swift
StrengthMaxxing/            shared by both apps
  Core/                     PURE Swift (Foundation only) — compiled by Package.swift + tests
    RepCounter.swift        velocity/rotation lobe counter, set-start detection, recording
    Calibrator.swift        per-exercise learning from corrections (+ CalibrationBook)
    RestAlarm.swift         resting → alarming → snoozed … → done state machine
    Outbox.swift            ordered offline queue (createSession / addSet / finish / calibration / traces)
    Units.swift  FileStore.swift
  Models/                   API models (v2 contract), superset planner
  Networking/ Settings/ Sync/ Health/
StrengthMaxxing Watch App/  Motion (CoreMotion → RepCounter), Session (VM, rest alarm, voice, HKWorkoutSession), Views
StrengthMaxxing iOS/        WebShellView (WKWebView on the live site) + NativeBridge (Health, watch hookup)
Tests/StrengthMaxxingTests/ synthetic-signal tests
```

## How it works

- **Rep counting**: vertical velocity (userAcceleration projected on gravity, integrated)
  and rotation rate on the dominant axis, band-passed and mixed per exercise. One rep =
  one up lobe + one down lobe, so slow reps aren't double-counted, and the threshold is
  relative to your running rep size, so heavy slow reps still count. Motion runs all
  workout: a set "starts" after 2 consistent reps (walking/unracking don't count), and
  those 2 are counted retroactively.
- **Learning**: correct the count on the review screen and the watch replays that set's
  recorded motion over a parameter grid, keeps the closest fit that gives your number, and
  blends it into that exercise's params (synced via `/api/calibration`). Accepting the count
  reinforces. Raw motion goes to `/api/motion-traces` when corrected, or always if
  "Record motion for tuning" is on.
- **Rest alarm**: buzzes every ~1.2 s when rest ends until you tap Dismiss or start lifting
  (auto-detected → straight into counting). Dismiss snoozes for `restAlarmSnoozeSec`, then
  buzzes again. A local notification is the fallback if the app gets suspended.
- **Offline**: everything is queued on disk and synced in order with backoff; workouts and
  settings are cached so you can start a workout with no signal.
- **Units**: kg on the wire; lb (default) or kg on screen, with 5 lb / 2.5 lb steppers.
