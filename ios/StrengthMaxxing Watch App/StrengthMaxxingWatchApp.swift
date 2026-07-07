//
//  StrengthMaxxingWatchApp.swift
//  StrengthMaxxing Watch App
//
//  watchOS app entry point.
//

import SwiftUI

@main
struct StrengthMaxxing_Watch_AppApp: App {
    @StateObject private var settings = AppSettings.shared

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environmentObject(settings)
        }
    }
}
