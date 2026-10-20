//
//  RestAlarm.swift
//  StrengthMaxxing (shared, PURE)
//
//  Rest timer + alarm state machine. Time is injected (`now`, seconds on any monotonic or
//  wall clock) and side effects are returned as `Effect`s, so it is fully testable. The
//  watch's RestAlarmController turns effects into haptics / local notifications.
//
//      resting ──(rest ends)──▶ alarming ──(dismiss)──▶ snoozed ──(snooze ends)──▶ alarming …
//         │                        │                       │
//         └──────── setStarted / skip (from any state) ────┴──────▶ done
//
//  While alarming it buzzes every `buzzInterval` s until dismissed or the next set starts.
//

import Foundation

struct RestAlarm: Equatable, Sendable {
    enum Phase: Equatable, Sendable {
        case idle, resting, alarming, snoozed, done
    }

    enum Effect: Equatable, Sendable {
        /// Play one alarm haptic. `index` lets the UI alternate patterns.
        case buzz(index: Int)
        /// (Re)schedule the background fallback notification at `at` (same clock as `now`).
        case scheduleFallback(at: Double)
        case cancelFallback
    }

    private(set) var phase: Phase = .idle
    private(set) var restEndsAt: Double = 0
    private(set) var snoozeUntil: Double = 0
    private(set) var nextBuzzAt: Double = 0
    private(set) var buzzCount = 0
    private(set) var totalRest: Double = 0
    var snoozeSec: Double
    var buzzInterval: Double

    init(snoozeSec: Double = 60, buzzInterval: Double = 1.2) {
        self.snoozeSec = snoozeSec
        self.buzzInterval = buzzInterval
    }

    var isActive: Bool { phase == .resting || phase == .alarming || phase == .snoozed }

    func remaining(now: Double) -> Double {
        phase == .resting ? max(0, restEndsAt - now) : 0
    }

    /// Seconds past the planned rest (shown as "+1:23 over").
    func overRest(now: Double) -> Double {
        (phase == .alarming || phase == .snoozed) ? max(0, now - restEndsAt) : 0
    }

    func progress(now: Double) -> Double {
        guard totalRest > 0 else { return 1 }
        return min(1, max(0, 1 - remaining(now: now) / totalRest))
    }

    mutating func start(restSec: Double, now: Double) -> [Effect] {
        totalRest = max(0, restSec)
        restEndsAt = now + totalRest
        buzzCount = 0
        phase = .resting
        if totalRest <= 0 { return beginAlarm(now: now) }
        return [.scheduleFallback(at: restEndsAt)]
    }

    /// Call ~4×/s (and on wake). Fires the alarm and repeating buzzes.
    mutating func tick(now: Double) -> [Effect] {
        switch phase {
        case .resting where now >= restEndsAt:
            return beginAlarm(now: now)
        case .snoozed where now >= snoozeUntil:
            return beginAlarm(now: now)
        case .alarming where now >= nextBuzzAt:
            // If we were suspended for a while, buzz once and resume the cadence from now.
            nextBuzzAt = max(nextBuzzAt + buzzInterval, now + buzzInterval * 0.5)
            buzzCount += 1
            return [.buzz(index: buzzCount - 1)]
        default:
            return []
        }
    }

    /// User tapped Dismiss: silence, and alarm again after `snoozeSec` unless a set starts.
    mutating func dismiss(now: Double) -> [Effect] {
        guard phase == .alarming else { return [] }
        phase = .snoozed
        snoozeUntil = now + snoozeSec
        return [.scheduleFallback(at: snoozeUntil)]
    }

    /// Rep counter saw the next set start — stop everything.
    mutating func setStarted() -> [Effect] {
        finish()
    }

    /// User skipped rest / moved on manually.
    mutating func skip() -> [Effect] {
        finish()
    }

    /// "+30 s" / "−15 s" while resting.
    mutating func adjust(by sec: Double, now: Double) -> [Effect] {
        guard phase == .resting else { return [] }
        restEndsAt = max(now, restEndsAt + sec)
        totalRest = max(1, totalRest + sec)
        return [.scheduleFallback(at: restEndsAt)]
    }

    private mutating func finish() -> [Effect] {
        guard phase != .idle && phase != .done else { return [] }
        phase = .done
        return [.cancelFallback]
    }

    private mutating func beginAlarm(now: Double) -> [Effect] {
        phase = .alarming
        nextBuzzAt = now + buzzInterval
        buzzCount += 1
        return [.buzz(index: buzzCount - 1)]
    }
}
