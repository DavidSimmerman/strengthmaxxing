//
//  WatchRootView.swift
//  StrengthMaxxing Watch App
//
//  Root navigation: pick a workout, then run the active session. Also a small settings
//  screen so the watch can be pointed at the server independently (direct-to-API model).
//

import SwiftUI

struct WatchRootView: View {
    @EnvironmentObject var settings: AppSettings
    @StateObject private var loader = WatchWorkoutsLoader()

    var body: some View {
        NavigationStack {
            List {
                if !settings.baseURLString.isEmpty {
                    Section {
                        switch loader.state {
                        case .idle, .loading:
                            HStack { ProgressView(); Text("Loading…") }
                        case .loaded(let workouts):
                            if workouts.isEmpty {
                                Text("No workouts. Create one on iPhone.")
                                    .font(.footnote).foregroundStyle(.secondary)
                            } else {
                                ForEach(workouts) { w in
                                    NavigationLink {
                                        ActiveSessionView(viewModel: WorkoutSessionViewModel(workout: w))
                                    } label: {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(w.name).font(.headline)
                                            Text("\(w.exercises.count) exercises")
                                                .font(.caption2).foregroundStyle(.secondary)
                                        }
                                    }
                                }
                            }
                        case .failed(let msg):
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Couldn't load").font(.headline)
                                Text(msg).font(.caption2).foregroundStyle(.secondary)
                                Button("Retry") { Task { await loader.load() } }
                            }
                        }
                    } header: {
                        Text("Workouts")
                    }
                } else {
                    Text("Set your server URL in Settings.")
                        .font(.footnote).foregroundStyle(.secondary)
                }

                Section {
                    NavigationLink("Settings") { WatchSettingsView() }
                }
            }
            .navigationTitle("StrengthMaxxing")
            .task { await loader.load() }
        }
    }
}

@MainActor
final class WatchWorkoutsLoader: ObservableObject {
    enum State {
        case idle, loading
        case loaded([Workout])
        case failed(String)
    }
    @Published var state: State = .idle

    func load() async {
        state = .loading
        do {
            let workouts = try await APIClient.shared.getWorkouts()
                .filter { $0.archived != true }
            state = .loaded(workouts)
        } catch {
            state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}
