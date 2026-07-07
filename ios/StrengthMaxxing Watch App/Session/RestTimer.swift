//
//  RestTimer.swift
//  StrengthMaxxing Watch App
//
//  Rest countdown with looping "alarm" haptics.
//
//  Approach:
//   - Start a countdown for `restSec`. We compute remaining time from an absolute end
//     Date (fireDate) rather than decrementing a counter, so it stays accurate even if
//     the display timer coalesces or the app is briefly backgrounded.
//   - A 0.25s display timer drives the visible countdown.
//   - When remaining reaches 0 we flip into `.alarming` and start a SEPARATE repeating
//     timer that fires `WKInterfaceDevice.current().play(.notification)` every ~1.2s —
//     a real, repeating buzz like an alarm clock — until the user taps Stop.
//   - `stop()` cancels both timers and clears the alarm.
//
//  For supersets, the caller simply doesn't start a RestTimer between exercises of the
//  same group; it only starts one after the last exercise in the group (see
//  WorkoutSessionViewModel).
//

import Foundation
import Combine
#if os(watchOS)
import WatchKit
#endif

@MainActor
final class RestTimer: ObservableObject {
    enum State: Equatable {
        case idle
        case counting
        case alarming
    }

    @Published private(set) var state: State = .idle
    /// Seconds remaining (clamped ≥ 0).
    @Published private(set) var remaining: Int = 0
    /// Total configured rest, for progress rings.
    @Published private(set) var total: Int = 0

    private var displayTimer: Timer?
    private var hapticTimer: Timer?
    private var fireDate: Date?

    /// How often the alarm buzzes while ringing.
    private let hapticInterval: TimeInterval = 1.2

    var progress: Double {
        guard total > 0 else { return 0 }
        return 1.0 - (Double(remaining) / Double(total))
    }

    /// Begin a rest countdown for `seconds`. Restarts cleanly if already running.
    func start(seconds: Int) {
        stop()
        guard seconds > 0 else {
            // No rest configured — go straight to alarm-less idle (or beep once).
            state = .idle
            return
        }
        total = seconds
        remaining = seconds
        fireDate = Date().addingTimeInterval(TimeInterval(seconds))
        state = .counting

        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        displayTimer = t
    }

    private func tick() {
        guard let fireDate, state == .counting else { return }
        let secsLeft = fireDate.timeIntervalSinceNow
        remaining = max(0, Int(secsLeft.rounded(.up)))
        if secsLeft <= 0 {
            beginAlarm()
        }
    }

    private func beginAlarm() {
        displayTimer?.invalidate()
        displayTimer = nil
        remaining = 0
        state = .alarming

        // Immediate buzz, then repeat until stopped.
        playHaptic()
        let h = Timer(timeInterval: hapticInterval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.playHaptic() }
        }
        RunLoop.main.add(h, forMode: .common)
        hapticTimer = h
    }

    private func playHaptic() {
        #if os(watchOS)
        WKInterfaceDevice.current().play(.notification)
        #endif
    }

    /// Stop counting and/or silence the alarm.
    func stop() {
        displayTimer?.invalidate()
        displayTimer = nil
        hapticTimer?.invalidate()
        hapticTimer = nil
        fireDate = nil
        state = .idle
    }

    /// Add/subtract seconds mid-rest (e.g. "+30s" button).
    func adjust(by delta: Int) {
        guard state == .counting, let fd = fireDate else { return }
        fireDate = fd.addingTimeInterval(TimeInterval(delta))
        total = max(total + delta, 1)
        tick()
    }

    // No deinit timer teardown: `stop()` is always called by the owning view model
    // (on finish / cancel / advance), and the timers hold only `[weak self]`, so there's
    // no retain cycle. This keeps cleanup on the main actor where the timers were scheduled.
}
