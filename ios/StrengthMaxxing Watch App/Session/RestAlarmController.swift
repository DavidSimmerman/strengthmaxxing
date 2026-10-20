//
//  RestAlarmController.swift
//  StrengthMaxxing Watch App
//
//  Drives the pure `RestAlarm` state machine with a 4 Hz main-run-loop timer and turns its
//  effects into real-world output:
//   - .buzz       → WKInterfaceDevice haptic, alternating .notification / .retry so it
//                   feels like an alarm, not a single tap.
//   - .scheduleFallback / .cancelFallback → a local notification at rest end / snooze end,
//                   in case watchOS suspends the app (e.g. no HealthKit permission ⇒ no
//                   workout session keeping us alive).
//

import Foundation
import Combine
import WatchKit
import UserNotifications

@MainActor
final class RestAlarmController: ObservableObject {
    @Published private(set) var alarm = RestAlarm()
    /// Re-published every tick so time-based views refresh.
    @Published private(set) var now: Double = Date().timeIntervalSince1970

    private var timer: Timer?
    private static let notificationId = "sm.rest-alarm"

    var phase: RestAlarm.Phase { alarm.phase }
    var remaining: Double { alarm.remaining(now: now) }
    var overRest: Double { alarm.overRest(now: now) }
    var progress: Double { alarm.progress(now: now) }
    var snoozeRemaining: Double { alarm.phase == .snoozed ? max(0, alarm.snoozeUntil - now) : 0 }

    static func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    func start(restSec: Int, snoozeSec: Int) {
        alarm = RestAlarm(snoozeSec: Double(max(snoozeSec, 5)))
        let t = clock()
        apply(alarm.start(restSec: Double(restSec), now: t))
        startTimer()
    }

    func dismiss() { apply(alarm.dismiss(now: clock())) }

    /// The rep counter detected the next set.
    func setStarted() { apply(alarm.setStarted()); stopTimer() }

    func skip() { apply(alarm.skip()); stopTimer() }

    func adjust(by sec: Int) { apply(alarm.adjust(by: Double(sec), now: clock())) }

    /// Catch up after wake (timers don't fire while suspended).
    func refresh() { tick() }

    // MARK: Internals

    private func clock() -> Double {
        now = Date().timeIntervalSince1970
        return now
    }

    private func startTimer() {
        stopTimer()
        let t = Timer(timeInterval: 0.25, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    private func stopTimer() {
        timer?.invalidate()
        timer = nil
    }

    private func tick() {
        apply(alarm.tick(now: clock()))
        if !alarm.isActive { stopTimer() }
    }

    private func apply(_ effects: [RestAlarm.Effect]) {
        for e in effects {
            switch e {
            case .buzz(let index):
                WKInterfaceDevice.current().play(index % 2 == 0 ? .notification : .retry)
            case .scheduleFallback(let at):
                scheduleNotification(at: at)
            case .cancelFallback:
                UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [Self.notificationId])
            }
        }
    }

    private func scheduleNotification(at: Double) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [Self.notificationId])
        let content = UNMutableNotificationContent()
        content.title = "Rest over"
        content.body = "Time for your next set."
        content.sound = .default
        let delay = max(1, at - Date().timeIntervalSince1970)
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: delay, repeats: false)
        center.add(UNNotificationRequest(identifier: Self.notificationId, content: content, trigger: trigger))
    }
}
