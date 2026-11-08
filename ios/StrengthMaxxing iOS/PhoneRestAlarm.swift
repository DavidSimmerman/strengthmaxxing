//
//  PhoneRestAlarm.swift
//  StrengthMaxxing iOS
//
//  The phone's rest alarm: rings when rest ends and keeps ringing until dismissed, even with
//  the phone locked, the app in the background or the ringer switch on silent.
//
//   - iOS 26+: AlarmKit, the same alarm the Clock app uses (full-screen alert, Stop button).
//   - Otherwise (older iOS, or Alarms not allowed in Settings):
//       app open   → the phone plays rest-alarm.wav on a loop at media volume, even on silent;
//       app closed → notifications every 30 s for 3 minutes, each playing the 28 s alarm tone
//                    (a notification's own sound is one short chime, which is easy to miss).
//
//  Only one rest alarm exists at a time; scheduling again replaces it.
//

import AVFoundation
import Foundation
import SwiftUI
import UIKit
import UserNotifications
#if canImport(AlarmKit)
import AlarmKit
#endif

@MainActor
final class PhoneRestAlarm {
    static let shared = PhoneRestAlarm()

    private var alarmId: UUID?
    private static let notificationPrefix = "sm.rest."
    private static let burst = 6           // 6 × 30 s = 3 minutes of reminders
    private static let burstGap: Double = 30
    private static let soundName = "rest-alarm.wav"
    private static let ringFor: Double = 180

    // Fallback ringing while the app is open.
    private var endsAt: Date?
    private var fire: Timer?
    private var player: AVAudioPlayer?
    private var activeObserver: NSObjectProtocol?

    private init() {
        // Back in the app after the rest ran out (notifications don't sound in the foreground):
        // ring here instead, for whatever is left of the 3 minutes.
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { _ in
            Task { @MainActor in PhoneRestAlarm.shared.ringIfDue() }
        }
    }

    /// Ring at `endsAt`. Returns true if the phone will ring (the page then stays quiet).
    func schedule(endsAt: Date) async -> Bool {
        await cancel()
        let delay = endsAt.timeIntervalSinceNow
        guard delay > 0.5 else { return false }
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), await scheduleAlarmKit(at: endsAt) { return true }
        #endif
        self.endsAt = endsAt
        fire = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            Task { @MainActor in PhoneRestAlarm.shared.ringIfDue() }
        }
        _ = await scheduleNotifications(at: endsAt)
        return true // the phone rings either way: in-app loop when open, notifications when not
    }

    /// Loop the alarm tone at full media volume, ignoring the silent switch, until dismissed.
    private func ringIfDue() {
        guard let end = endsAt, player == nil, UIApplication.shared.applicationState == .active else { return }
        let left = Self.ringFor - Date().timeIntervalSince(end)
        guard Date() >= end, left > 0 else { return }
        // The app is open and ringing itself, so the notifications would only add chimes.
        clearNotifications()
        guard let url = Bundle.main.url(forResource: "rest-alarm", withExtension: "wav") else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [.duckOthers])
        try? session.setActive(true)
        guard let p = try? AVAudioPlayer(contentsOf: url) else { return }
        p.numberOfLoops = -1
        p.volume = 1
        p.play()
        player = p
        fire = Timer.scheduledTimer(withTimeInterval: left, repeats: false) { _ in
            Task { @MainActor in PhoneRestAlarm.shared.stopRinging() }
        }
    }

    private func stopRinging() {
        player?.stop()
        player = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func clearNotifications() {
        let ids = (0..<Self.burst).map { Self.notificationPrefix + String($0) }
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: ids)
        center.removeDeliveredNotifications(withIdentifiers: ids)
    }

    func cancel() async {
        #if canImport(AlarmKit)
        if #available(iOS 26.0, *), let id = alarmId {
            try? AlarmManager.shared.cancel(id: id)
        }
        #endif
        alarmId = nil
        endsAt = nil
        fire?.invalidate()
        fire = nil
        stopRinging()
        // Older builds scheduled up to 18 reminders; clear those too.
        let ids = (0..<18).map { Self.notificationPrefix + String($0) }
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

    @discardableResult
    private func scheduleNotifications(at date: Date) async -> Bool {
        let center = UNUserNotificationCenter.current()
        guard (try? await center.requestAuthorization(options: [.alert, .sound])) == true else { return false }
        let start = date.timeIntervalSinceNow
        for i in 0..<Self.burst {
            let content = UNMutableNotificationContent()
            content.title = "Rest over"
            content.body = "Time for your next set."
            content.sound = UNNotificationSound(named: UNNotificationSoundName(Self.soundName))
            content.interruptionLevel = .timeSensitive
            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, start + Double(i) * Self.burstGap), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: Self.notificationPrefix + String(i), content: content, trigger: trigger))
        }
        return true
    }
}
