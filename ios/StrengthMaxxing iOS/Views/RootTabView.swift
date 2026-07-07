//
//  RootTabView.swift
//  StrengthMaxxing iOS
//
//  Three tabs: Workouts (browse + start), History, Settings.
//

import SwiftUI

struct RootTabView: View {
    var body: some View {
        TabView {
            WorkoutsListView()
                .tabItem { Label("Workouts", systemImage: "dumbbell.fill") }

            HistoryView()
                .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }

            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
    }
}
