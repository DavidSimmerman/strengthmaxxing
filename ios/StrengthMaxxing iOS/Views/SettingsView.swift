//
//  SettingsView.swift
//  StrengthMaxxing iOS
//
//  Server URL + API token (stored in Keychain), bodyweight, HealthKit status, and a
//  connectivity test.
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var health: HealthKitManager
    @State private var pingState: PingState = .idle

    enum PingState: Equatable {
        case idle, testing, ok, failed(String)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("https://your-server:3000", text: $settings.baseURLString)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("API token (optional)", text: $settings.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } header: {
                    Text("Server")
                } footer: {
                    Text("The base URL of your strengthmaxxing web app. The token is required only if the server has API_TOKEN set. Stored securely in the Keychain.")
                }

                Section("Profile") {
                    HStack {
                        Text("Bodyweight")
                        Spacer()
                        TextField("kg", value: $settings.bodyweightKg, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 90)
                        Text("kg").foregroundStyle(.secondary)
                    }
                }

                Section("Connection") {
                    Button {
                        Task { await test() }
                    } label: {
                        HStack {
                            Text("Test connection")
                            Spacer()
                            switch pingState {
                            case .idle: EmptyView()
                            case .testing: ProgressView()
                            case .ok: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                            case .failed: Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
                            }
                        }
                    }
                    if case .failed(let msg) = pingState {
                        Text(msg).font(.caption).foregroundStyle(.red)
                    }
                }

                Section {
                    HStack {
                        Text("HealthKit")
                        Spacer()
                        if !health.isHealthDataAvailable {
                            Text("Unavailable").foregroundStyle(.secondary)
                        } else if health.isAuthorized {
                            Label("Authorized", systemImage: "heart.fill")
                                .foregroundStyle(.green)
                        } else {
                            Button("Enable") { Task { await health.requestAuthorization() } }
                        }
                    }
                } header: {
                    Text("Apple Health")
                } footer: {
                    Text("Finished workouts are written to Apple Fitness as Traditional Strength Training, including active energy from your session.")
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func test() async {
        pingState = .testing
        do { _ = try await APIClient.shared.ping(); pingState = .ok }
        catch {
            pingState = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}
