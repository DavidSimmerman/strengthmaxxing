//
//  AppSettings.swift
//  StrengthMaxxing (shared)
//
//  Stores the server base URL (UserDefaults) and the bearer API token (Keychain).
//  Observable so SwiftUI settings views update live.
//
//  NOTE: this type is shared by the iOS and watchOS targets. When the watch talks to
//  the API directly (our chosen approach — see README), each device keeps its own copy;
//  the token is entered once per device. If you'd rather push the token from phone →
//  watch, wire up WatchConnectivity (see README "WatchConnectivity note").
//

import Foundation
import Combine

/// Immutable, Sendable snapshot of the config an API request needs. Taken on the main
/// actor and handed to the (non-isolated) APIClient so no mutable UI state crosses actors.
struct APIConfig: Sendable {
    let baseURL: URL?
    let token: String
}

@MainActor
final class AppSettings: ObservableObject {
    /// `nonisolated` so the singleton instance can be *obtained* from any context; its
    /// mutable properties are still main-actor-isolated and require `await` to read/write.
    nonisolated(unsafe) static let shared = AppSettings()

    private enum Keys {
        static let baseURL = "sm.baseURL"
        static let bodyweightKg = "sm.bodyweightKg"
    }

    /// Suite shared with a possible App Group. If you add an App Group entitlement
    /// (e.g. "group.tech.simmerman.strengthmaxxing") the two targets can share defaults.
    private let defaults: UserDefaults

    @Published var baseURLString: String {
        didSet { defaults.set(baseURLString, forKey: Keys.baseURL) }
    }

    /// Cached mirror of the Keychain token so SwiftUI can bind to it.
    @Published var token: String {
        didSet { Keychain.set(token, for: Keychain.tokenKey) }
    }

    /// Default bodyweight used when starting sessions / writing HealthKit for bodyweight math.
    @Published var bodyweightKg: Double {
        didSet { defaults.set(bodyweightKg, forKey: Keys.bodyweightKg) }
    }

    private init() {
        // Fall back to standard defaults if no App Group is configured.
        let d = UserDefaults(suiteName: "group.tech.simmerman.strengthmaxxing") ?? .standard
        self.defaults = d
        self.baseURLString = d.string(forKey: Keys.baseURL) ?? "http://localhost:3000"
        self.token = Keychain.get(Keychain.tokenKey) ?? ""
        let bw = d.double(forKey: Keys.bodyweightKg)
        self.bodyweightKg = bw > 0 ? bw : 80
    }

    /// Validated base URL, or nil if the user hasn't entered a usable value.
    var baseURL: URL? {
        let trimmed = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed) else { return nil }
        return url
    }

    var hasToken: Bool { !token.trimmingCharacters(in: .whitespaces).isEmpty }

    /// A Sendable snapshot for use off the main actor (by APIClient).
    var apiConfig: APIConfig {
        APIConfig(baseURL: baseURL, token: token.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

// MARK: - Minimal Keychain wrapper

/// Tiny generic-password Keychain helper. Avoids a dependency for a single secret.
enum Keychain {
    static let tokenKey = "sm.apiToken"
    /// Change this to your real bundle prefix; must be stable across launches.
    private static let service = "tech.simmerman.strengthmaxxing"

    @discardableResult
    static func set(_ value: String, for account: String) -> Bool {
        let data = Data(value.utf8)
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return true } // empty ⇒ just delete
        var add = base
        add[kSecValueData as String] = data
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
