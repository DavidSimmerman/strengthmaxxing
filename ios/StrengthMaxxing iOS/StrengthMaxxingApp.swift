//
//  StrengthMaxxingApp.swift
//  StrengthMaxxing iOS
//
//  iPhone app entry point. Activates WatchConnectivity (pushes URL + token to the watch)
//  and pulls the shared server settings (units etc.).
//

import SwiftUI

@main
struct StrengthMaxxingApp: App {
    @StateObject private var settings = AppSettings.shared
    @StateObject private var health = HealthKitManager.shared

    init() {
        SettingsSync.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(settings)
                .environmentObject(health)
                .task {
                    // Ask for HealthKit up front; the system only prompts once.
                    await health.requestAuthorization()
                    await SyncService.shared.refreshRemote()
                }
        }
    }
}
