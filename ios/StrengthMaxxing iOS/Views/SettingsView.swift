//
//  SettingsView.swift
//  StrengthMaxxing iOS
//
//  Server URL + API token (Keychain) — pushed to the Apple Watch automatically — plus
//  units (shared with the dashboard via /api/settings), bodyweight, HealthKit status.
//

import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @EnvironmentObject var health: HealthKitManager
    @ObservedObject private var sync = SyncService.shared
    @State private var pingState: PingState = .idle
    @State private var watchStatus: String?

    enum PingState: Equatable {
        case idle, testing, ok, failed(String)
    }

    private var bodyweightBinding: Binding<Double> {
        Binding(
            get: { Units.displayRounded(kg: settings.bodyweightKg, unit: settings.units) },
            set: { settings.bodyweightKg = Units.toKg($0, unit: settings.units) }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(AppSettings.defaultBaseURL, text: $settings.baseURLString)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("API token", text: $settings.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Send to Apple Watch") { pushToWatch(force: true) }
                    if let watchStatus {
                        Text(watchStatus).font(.caption).foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Server")
                } footer: {
                    Text("Changes are sent to your Apple Watch automatically. The token is stored in the Keychain.")
                }

                Section("Units & profile") {
                    Picker("Weight units", selection: $settings.units) {
                        Text("Pounds (lb)").tag(WeightUnit.lb)
                        Text("Kilograms (kg)").tag(WeightUnit.kg)
                    }
                    HStack {
                        Text("Bodyweight")
                        Spacer()
                        TextField(settings.units.symbol, value: bodyweightBinding, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 90)
                        Text(settings.units.symbol).foregroundStyle(.secondary)
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
                    if sync.pendingCount > 0 {
                        LabeledContent("Waiting to sync", value: "\(sync.pendingCount)")
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
                    Text("Workouts finished on iPhone are written to Apple Fitness. Workouts run on the watch are saved by the watch.")
                }
            }
            .navigationTitle("Settings")
            .onChange(of: settings.baseURLString) { pushToWatch(force: false) }
            .onChange(of: settings.token) { pushToWatch(force: false) }
            .onChange(of: settings.units) { _, units in
                Task { try? await APIClient.shared.patchSettings(SettingsPatch(units: units)) }
            }
        }
    }

    private func pushToWatch(force: Bool) {
        switch SettingsSync.shared.pushCurrent(force: force) {
        case .sent: watchStatus = force ? "Sent to watch." : nil
        case .noWatch: watchStatus = force ? "No paired watch with the app installed." : nil
        case .notReady: watchStatus = "Watch connection not ready yet."
        case .failed(let msg): watchStatus = "Couldn't send: \(msg)"
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
