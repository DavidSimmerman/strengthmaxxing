//
//  PhoneRestAlarm.swift
//  StrengthMaxxing iOS
//
//  The phone's rest alarm: rings when rest ends and keeps ringing until dismissed, even with
//  the phone locked, the app in the background or the ringer switch on silent.
//
//   - iOS 26+: AlarmKit, the same alarm the Clock app uses (full-screen alert, Stop button).
//   - Older iOS: a burst of local notifications every 10 s for 3 minutes, cancelled on dismiss.
//
//  Only one rest alarm exists at a time; scheduling again replaces it.
//

import Foundation
import SwiftUI
import UserNotifications
#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class PhoneRestAlarm {
    static let shared = PhoneRestAlarm()

    private var alarmId: UUID?
    private static let notificationPrefix = "sm.rest."
    private static let burst = 18          // 18 × 10 s = 3 minutes of reminders
    private static let burstGap: Double = 10

    /// Ring at `endsAt`. Returns true if the phone will ring (the page then stays quiet).
    func schedule(endsAt: Date) async -> Bool {
        await cancel()
        let delay = endsAt.timeIntervalSinceNow
        guard delay > 0.5 else { return false }
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), await scheduleAlarmKit(at: endsAt) { return true }
        #endif
        return await scheduleNotifications(at: endsAt)
    }

    func cancel() async {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), let id = alarmId {
            try? AlarmManager.shared.cancel(id: id)
        }
        #endif
        alarmId = nil
        let ids = (0..<Self.burst).map { Self.notificationPrefix + String($0) }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    // MARK: AlarmKit

    #if canImport(AlarmKit)
    struct RestMetadata: AlarmMetadata {}

    @available(iOS 26.0, *)
    private func scheduleAlarmKit(at date: Date) async -> Bool {
        let manager = AlarmManager.shared
        switch manager.authorizationState {
        case .authorized: break
        case .notDetermined:
            guard (try? await manager.requestAuthorization()) == .authorized else { return false }
        default: return false
        }
        let alert = AlarmPresentation.Alert(
            title: "Rest over: next set",
            stopButton: AlarmButton(text: "Dismiss", textColor: .white, systemImageName: "checkmark"))
        let attributes = AlarmAttributes<RestMetadata>(
            presentation: AlarmPresentation(alert: alert),
            metadata: RestMetadata(),
            tintColor: Color(red: 1, green: 92 / 255, blue: 0))
        let id = UUID()
        do {
            _ = try await manager.schedule(id: id, configuration: .alarm(schedule: .fixed(date), attributes: attributes))
            alarmId = id
            return true
        } catch {
            return false
        }
    }
    #endif

    // MARK: Notification fallback

    private func scheduleNotifications(at date: Date) async -> Bool {
        let center = UNUserNotificationCenter.current()
        guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return false }
        let start = date.timeIntervalSinceNow
        for i in 0..<Self.burst {
            let content = UNMutableNotificationContent()
            content.title = "Rest over"
            content.body = "Time for your next set."
            content.sound = .default
            content.interruptionLevel = .timeSensitive
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, start + Double(i) * Self.burstGap), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: Self.notificationPrefix + String(i), content: content, trigger: trigger))
        }
        return true
    }
}
