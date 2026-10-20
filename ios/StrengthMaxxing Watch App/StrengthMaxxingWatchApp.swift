//
//  StrengthMaxxingWatchApp.swift
//  StrengthMaxxing Watch App
//
//  watchOS app entry point. On launch: start WatchConnectivity (receives URL + token from
//  the phone), then refresh cached settings / calibration / workouts and flush the outbox.
//

import SwiftUI

@main
struct StrengthMaxxing_Watch_AppApp: App {
    @StateObject private var settings = AppSettings.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        SettingsSync.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environmentObject(settings)
                .task { await SyncService.shared.refreshRemote() }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await SyncService.shared.syncNow() } }
        }
    }
}
