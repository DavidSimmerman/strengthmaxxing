//
//  StrengthMaxxingApp.swift
//  StrengthMaxxing iOS
//
//  The iPhone app is the web dashboard (https://strengthmaxxing.simmerman.tech) in a native
//  shell, so deploying the web app updates the phone app. Native code only does what a web
//  page can't: Apple Health, and handing the API token to the watch (WatchConnectivity).
//

import SwiftUI

@main
struct StrengthMaxxingApp: App {
    init() {
        SettingsSync.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            WebShellView()
                .ignoresSafeArea()               // the page handles safe areas via env(safe-area-inset-*)
                .background(Color(red: 10 / 255, green: 10 / 255, blue: 12 / 255))
                .preferredColorScheme(.dark)
        }
    }
}
