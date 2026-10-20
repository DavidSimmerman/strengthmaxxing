//
//  SettingsSync.swift
//  StrengthMaxxing (shared)
//
//  Phone → watch push of the server URL + API token over WatchConnectivity
//  (`updateApplicationContext`: latest value wins, delivered even if the watch app isn't
//  running). The watch applies it to AppSettings; its own Settings screen can still
//  override until the next push.
//

import Foundation
#if canImport(WatchConnectivity)
import WatchConnectivity

final class SettingsSync: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = SettingsSync()

    private enum Key {
        static let baseURL = "baseURL"
        static let token = "token"
        static let sentAt = "sentAt"
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        s.activate()
    }

    #if os(iOS)
    enum PushResult: Equatable { case sent, noWatch, notReady, failed(String) }

    /// Sends the current URL + token to the watch if they changed since the last push
    /// (or always with `force`), so the watch's own override isn't clobbered on every launch.
    @MainActor
    @discardableResult
    func pushCurrent(force: Bool = false) -> PushResult {
        guard WCSession.isSupported() else { return .noWatch }
        let s = WCSession.default
        guard s.activationState == .activated else { return .notReady }
        guard s.isPaired, s.isWatchAppInstalled else { return .noWatch }
        let settings = AppSettings.shared
        let fingerprint = "\(settings.baseURLString)\n\(settings.token)"
        let lastKey = "sm.watchPush.last"
        if !force, UserDefaults.standard.string(forKey: lastKey) == fingerprint { return .sent }
        do {
            try s.updateApplicationContext([
                Key.baseURL: settings.baseURLString,
                Key.token: settings.token,
                Key.sentAt: Date().timeIntervalSince1970,
            ])
            UserDefaults.standard.set(fingerprint, forKey: lastKey)
            return .sent
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        // Switching watches: re-activate for the new one.
        session.activate()
    }
    #endif

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState,
                 error: Error?) {
        guard activationState == .activated else { return }
        #if os(iOS)
        Task { @MainActor in self.pushCurrent() }
        #else
        let ctx = session.receivedApplicationContext
        if !ctx.isEmpty { apply(ctx) }
        #endif
    }

    #if os(watchOS)
    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        apply(applicationContext)
    }

    /// Applies each phone push once, so a manual override on the watch survives relaunches
    /// (the stale context is re-delivered on every activation).
    private func apply(_ ctx: [String: Any]) {
        let sentAt = ctx[Key.sentAt] as? Double ?? 0
        let lastKey = "sm.phonePush.lastSentAt"
        guard sentAt > UserDefaults.standard.double(forKey: lastKey) else { return }
        UserDefaults.standard.set(sentAt, forKey: lastKey)
        let url = ctx[Key.baseURL] as? String
        let token = ctx[Key.token] as? String
        Task { @MainActor in
            AppSettings.shared.applyFromPhone(baseURL: url, token: token)
            await SyncService.shared.refreshRemote()
        }
    }
    #endif
}
#endif
