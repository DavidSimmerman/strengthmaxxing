//
//  StrengthMaxxingApp.swift
//  StrengthMaxxing iOS
//
//  iPhone app entry point.
//

import SwiftUI

@main
struct StrengthMaxxingApp: App {
    @StateObject private var settings = AppSettings.shared
    @StateObject private var health = HealthKitManager.shared

    var body: some Scene {
        WindowGroup {
            RootTabView()
                .environmentObject(settings)
                .environmentObject(health)
                .task {
                    // Ask for HealthKit up front; the system only prompts once.
                    await health.requestAuthorization()
                }
        }
    }
}
