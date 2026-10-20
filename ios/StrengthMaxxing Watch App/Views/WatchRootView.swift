//
//  WatchRootView.swift
//  StrengthMaxxing Watch App
//
//  Pick a workout (from the on-disk cache first, so it works offline; refreshed from the
//  server when reachable), then run it. Settings + sync status at the bottom.
//

import SwiftUI

struct WatchRootView: View {
    @EnvironmentObject var settings: AppSettings
    @ObservedObject private var sync = SyncService.shared
    @State private var workouts: [Workout] = []
    @State private var loadError: String?
    @State private var isRefreshing = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    if workouts.isEmpty {
                        if isRefreshing {
                            HStack { ProgressView(); Text("Loading…") }
                        } else {
                            Text(loadError ?? "No workouts yet. Create one on the web or iPhone.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    ForEach(workouts) { w in
                        NavigationLink(value: w) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(w.name).font(.headline)
                                Text("\(w.exercises.count) exercises")
                                    .font(.caption2).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: {
                    Text("Workouts")
                } footer: {
                    if loadError != nil && !workouts.isEmpty {
                        Text("Offline — showing saved workouts.")
                    }
                }

                Section {
                    if sync.pendingCount > 0 {
                        Button {
                            Task { await sync.syncNow() }
                        } label: {
                            Label("\(sync.pendingCount) to sync", systemImage: "icloud.and.arrow.up")
                        }
                    }
                    NavigationLink {
                        WatchSettingsView()
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                }
            }
            .navigationTitle("StrengthMaxxing")
            .navigationDestination(for: Workout.self) { w in
                ActiveSessionView(viewModel: WorkoutSessionViewModel(workout: w))
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func load() async {
        if workouts.isEmpty, let cached = sync.cachedWorkouts() { workouts = cached }
        isRefreshing = true
        defer { isRefreshing = false }
        do {
            workouts = try await sync.refreshWorkouts()
            loadError = nil
        } catch {
            loadError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
