//
//  WatchSettingsView.swift
//  StrengthMaxxing Watch App
//
//  Server URL + token normally arrive from the iPhone (WatchConnectivity); editing them
//  here overrides until the phone sends new ones. Units / voice / snooze default from
//  the server's settings.
//

import SwiftUI

struct WatchSettingsView: View {
    @EnvironmentObject var settings: AppSettings
    @ObservedObject private var sync = SyncService.shared
    @State private var pingResult: String?

    var body: some View {
        Form {
            Section("Counting") {
                Toggle("Speak rep count", isOn: $settings.voiceCount)
                Toggle("Record motion for tuning", isOn: $settings.recordMotion)
                Picker("Units", selection: $settings.units) {
                    Text("lb").tag(WeightUnit.lb)
                    Text("kg").tag(WeightUnit.kg)
                }
                Stepper(value: $settings.restAlarmSnoozeSec, in: 15...300, step: 15) {
                    Text("Snooze \(settings.restAlarmSnoozeSec)s")
                }
            }

            Section("Bodyweight") {
                Stepper {
                    Text(Units.format(kg: settings.bodyweightKg, unit: settings.units))
                } onIncrement: {
                    settings.bodyweightKg = Units.stepped(kg: settings.bodyweightKg, direction: 1,
                                                          category: "bodyweight", unit: settings.units)
                } onDecrement: {
                    settings.bodyweightKg = max(30, Units.stepped(kg: settings.bodyweightKg, direction: -1,
                                                                  category: "bodyweight", unit: settings.units))
                }
            }

            Section {
                TextField("Server URL", text: $settings.baseURLString)
                SecureField("API token", text: $settings.token)
            } header: {
                Text("Server")
            } footer: {
                Text("Set on your iPhone and sent to the watch automatically. Edit here to override.")
            }

            Section("Sync") {
                LabeledContent("Waiting", value: "\(sync.pendingCount)")
                if sync.deadLetterCount > 0 {
                    LabeledContent("Failed", value: "\(sync.deadLetterCount)")
                    if let err = sync.lastError { Text(err).font(.caption2).foregroundStyle(.orange) }
                    Button("Retry failed") { Task { await sync.requeueFailed() } }
                }
                Button("Sync now") { Task { await sync.refreshRemote() } }
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
        .onChange(of: settings.units) { _, units in
            // Units are shared with the dashboard + phone.
            Task { try? await APIClient.shared.patchSettings(SettingsPatch(units: units)) }
        }
    }
}
