//
//  NativeBridge.swift
//  StrengthMaxxing iOS
//
//  What the web page can ask the iPhone for. From JavaScript (see web/src/lib/native.ts):
//
//      const r = await window.webkit.messageHandlers.smx.postMessage({ action, ...args })
//
//  Every reply is a JSON-safe dictionary; failures come back as { error: "…" } rather than
//  a rejected promise, so the page can always continue without the native extra.
//
//  actions:
//    info                                   → { app, health, watchPaired, watchAppInstalled }
//    connectWatch { token, baseURL }         → { result: "sent" | "noWatch" | "notReady" | "failed: …" }
//    heartRateCalories { start, end }        → { kcal, avgHr, weightKg } | { kcal: null, weightKg }
//         (epoch ms; heart rate Health recorded in that window, e.g. by the watch)
//    saveWorkout { start, end, kcal?, name?, sessionId?, volumeKg?, replace? } → { saved: true, replaced }
//         replace: first delete this app's earlier workout for the same sessionId
//    restAlarm { endsAt }                    → { scheduled: Bool }  (epoch ms; rings until dismissed)
//    restAlarmCancel                         → { cancelled: true }
//    haptic { kind: "warning" | "success" }  → { ok: true }
//

import Foundation
import UIKit
import WebKit
import WatchConnectivity

final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    static let shared = NativeBridge()

    @MainActor
    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) async -> (Any?, String?) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else {
            return (["error": "bad message"], nil)
        }
        let health = HealthKitManager.shared
        func date(_ key: String) -> Date? {
            (body[key] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue / 1000) }
        }

        switch action {
        case "info":
            let s = WCSession.isSupported() ? WCSession.default : nil
            return ([
                "app": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1",
                "health": health.isHealthDataAvailable,
                "watchPaired": s?.isPaired ?? false,
                "watchAppInstalled": s?.isWatchAppInstalled ?? false,
            ], nil)

        case "connectWatch":
            guard let token = body["token"] as? String, !token.isEmpty else {
                return (["error": "token missing"], nil)
            }
            let settings = AppSettings.shared
            settings.token = token
            if let base = body["baseURL"] as? String, !base.isEmpty { settings.baseURLString = base }
            switch SettingsSync.shared.pushCurrent(force: true) {
            case .sent: return (["result": "sent"], nil)
            case .noWatch: return (["result": "noWatch"], nil)
            case .notReady: return (["result": "notReady"], nil)
            case .failed(let why): return (["result": "failed: \(why)"], nil)
            }

        case "heartRateCalories":
            guard let start = date("start"), let end = date("end") else { return (["error": "start/end required"], nil) }
            await health.requestAuthorization()
            let fallback = (body["fallbackWeightKg"] as? NSNumber)?.doubleValue
            let profile = await health.bodyProfile(fallbackWeightKg: fallback)
            var out: [String: Any] = ["kcal": NSNull(), "weightKg": profile?.weightKg ?? NSNull()]
            if let r = await health.heartRateCalories(start: start, end: end, fallbackWeightKg: fallback) {
                out["kcal"] = r.kcal
                out["avgHr"] = r.avgHr
            }
            return (out, nil)

        case "saveWorkout":
            guard let start = date("start"), let end = date("end") else { return (["error": "start/end required"], nil) }
            await health.requestAuthorization()
            do {
                var replaced = 0
                if body["replace"] as? Bool == true, let sid = (body["sessionId"] as? NSNumber)?.intValue {
                    replaced = try await health.deleteWorkouts(sessionId: sid)
                }
                try await health.saveStrengthWorkout(
                    start: start, end: end,
                    energyKcal: (body["kcal"] as? NSNumber)?.doubleValue,
                    sessionId: (body["sessionId"] as? NSNumber)?.intValue,
                    name: body["name"] as? String,
                    volumeKg: (body["volumeKg"] as? NSNumber)?.doubleValue)
                return (["saved": true, "replaced": replaced], nil)
            } catch {
                return (["error": error.localizedDescription], nil)
            }

        case "restAlarm":
            guard let endsAt = date("endsAt") else { return (["error": "endsAt required"], nil) }
            return (["scheduled": await PhoneRestAlarm.shared.schedule(endsAt: endsAt)], nil)

        case "haptic":
            let gen = UINotificationFeedbackGenerator()
            gen.notificationOccurred(body["kind"] as? String == "success" ? .success : .warning)
            return (["ok": true], nil)

        case "restAlarmCancel":
            await PhoneRestAlarm.shared.cancel()
            return (["cancelled": true], nil)

        default:
            return (["error": "unknown action \(action)"], nil)
        }
    }
}
