//
//  WatchSettingsView.swift
//  StrengthMaxxing Watch App
//
//  Point the watch at the server and enter the API token. Since the watch talks to the
//  API directly, it keeps its own copy of these (see README). Dictation/scribble entry.
//

import SwiftUI

struct WatchSettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @State private var pingResult: String?

    var body: some View {
        Form {
            Section("Server") {
                TextField("https://host:3000", text: $settings.baseURLString)
                    .textInputAutocapitalization(.never)
                SecureField("API token", text: $settings.token)
            }
            Section("Bodyweight") {
                Stepper(value: $settings.bodyweightKg, in: 30...250, step: 0.5) {
                    Text(String(format: "%.1f kg", settings.bodyweightKg))
                }
            }
            Section {
                Button("Test connection") {
                    Task {
                        do { _ = try await APIClient.shared.ping(); pingResult = "OK" }
                        catch { pingResult = (error as? APIError)?.errorDescription ?? "Failed" }
                    }
                }
                if let pingResult {
                    Text(pingResult).font(.caption2)
                        .foregroundStyle(pingResult == "OK" ? .green : .orange)
                }
            }
        }
        .navigationTitle("Settings")
    }
}
