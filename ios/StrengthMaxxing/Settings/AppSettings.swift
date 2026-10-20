//
//  AppSettings.swift
//  StrengthMaxxing (shared)
//
//  Server URL (UserDefaults) + API token (Keychain) + display/workout preferences.
//
//  - The phone pushes URL + token to the watch over WatchConnectivity (SettingsSync); the
//    watch's own Settings screen can still override them (latest change wins).
//  - units / voiceCount / restAlarmSnoozeSec mirror `GET /api/settings` and are cached
//    here so the watch works offline. A watch-side voice toggle sticks over the server value.
//

import Foundation
import Combine
import Security

/// Immutable, Sendable snapshot of the config an API request needs.
struct APIConfig: Sendable {
    let baseURL: URL?
    let token: String
}

@MainActor
final class AppSettings: ObservableObject {
    /// Main-actor isolated (created lazily on first main-actor access). Off-main code
    /// uses `await AppSettings.shared.apiConfig`.
    static let shared = AppSettings()

    static let defaultBaseURL = "https://strengthmaxxing.simmerman.tech"

    private enum Keys {
        static let baseURL = "sm.baseURL"
        static let bodyweightKg = "sm.bodyweightKg"
        static let units = "sm.units"
        static let voiceCount = "sm.voiceCount"
        static let voiceLocal = "sm.voiceCount.local"
        static let snooze = "sm.restAlarmSnoozeSec"
        static let recordMotion = "sm.recordMotion"
    }

    private let defaults: UserDefaults
    private var applyingServer = false

    @Published var baseURLString: String {
        didSet { defaults.set(baseURLString, forKey: Keys.baseURL) }
    }

    /// Cached mirror of the Keychain token so SwiftUI can bind to it.
    @Published var token: String {
        didSet { Keychain.set(token, for: Keychain.tokenKey) }
    }

    /// Always kg (converted for display).
    @Published var bodyweightKg: Double {
        didSet { defaults.set(bodyweightKg, forKey: Keys.bodyweightKg) }
    }

    @Published var units: WeightUnit {
        didSet { defaults.set(units.rawValue, forKey: Keys.units) }
    }

    /// Speak each rep number on the watch.
    @Published var voiceCount: Bool {
        didSet {
            defaults.set(voiceCount, forKey: Keys.voiceCount)
            if !applyingServer { defaults.set(true, forKey: Keys.voiceLocal) }
        }
    }

    @Published var restAlarmSnoozeSec: Int {
        didSet { defaults.set(restAlarmSnoozeSec, forKey: Keys.snooze) }
    }

    /// Upload raw motion for every set (not just corrected ones) to help tune the counter.
    @Published var recordMotion: Bool {
        didSet { defaults.set(recordMotion, forKey: Keys.recordMotion) }
    }

    private init() {
        let d = UserDefaults.standard
        self.defaults = d
        self.baseURLString = d.string(forKey: Keys.baseURL) ?? AppSettings.defaultBaseURL
        self.token = Keychain.get(Keychain.tokenKey) ?? ""
        let bw = d.double(forKey: Keys.bodyweightKg)
        self.bodyweightKg = bw > 0 ? bw : 80
        self.units = WeightUnit(rawValue: d.string(forKey: Keys.units) ?? "") ?? .lb
        self.voiceCount = d.object(forKey: Keys.voiceCount) as? Bool ?? true
        let snooze = d.integer(forKey: Keys.snooze)
        self.restAlarmSnoozeSec = snooze > 0 ? snooze : 60
        self.recordMotion = d.object(forKey: Keys.recordMotion) as? Bool ?? true
    }

    /// Validated base URL, or nil if the user hasn't entered a usable value.
    var baseURL: URL? {
        let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed), url.scheme != nil else { return nil }
        return url
    }

    var hasToken: Bool { !token.trimmingCharacters(in: .whitespaces).isEmpty }

    var apiConfig: APIConfig {
        APIConfig(baseURL: baseURL, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    var serverSettings: ServerSettings {
        ServerSettings(units: units, voiceCount: voiceCount, restAlarmSnoozeSec: restAlarmSnoozeSec)
    }

    /// Adopt `GET /api/settings`. A voice toggle made on this device wins over the server.
    func apply(_ s: ServerSettings) {
        applyingServer = true
        defer { applyingServer = false }
        if units != s.units { units = s.units }
        if !defaults.bool(forKey: Keys.voiceLocal), voiceCount != s.voiceCount { voiceCount = s.voiceCount }
        if s.restAlarmSnoozeSec > 0, restAlarmSnoozeSec != s.restAlarmSnoozeSec { restAlarmSnoozeSec = s.restAlarmSnoozeSec }
    }

    /// Connection settings pushed from the phone (WatchConnectivity).
    func applyFromPhone(baseURL: String?, token: String?) {
        if let baseURL, !baseURL.isEmpty, baseURL != baseURLString { baseURLString = baseURL }
        if let token, token != self.token { self.token = token }
    }
}

// MARK: - Minimal Keychain wrapper

enum Keychain {
    static let tokenKey = "sm.apiToken"
    /// Must be stable across launches.
    private static let service = "tech.simmerman.strengthmaxxing"

    @discardableResult
    static func set(_ value: String, for account: String) -> Bool {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return true }
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    static func get(_ account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}
