//
//  WorkoutsListView.swift
//  StrengthMaxxing iOS
//
//  Browse workout templates (GET /api/workouts) and start a session (POST /api/sessions)
//  which pushes into the active-session view.
//

import SwiftUI

@MainActor
final class WorkoutsListViewModel: ObservableObject {
    enum State {
        case idle, loading
        case loaded([Workout])
        case failed(String)
    }
    @Published var state: State = .idle
    @Published var startingWorkoutId: Int?

    private let api = APIClient.shared

    func load() async {
        state = .loading
        do {
            state = .loaded(try await SyncService.shared.refreshWorkouts())
        } catch {
            state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}

struct WorkoutsListView: View {
    @EnvironmentObject var settings: AppSettings
    @StateObject private var vm = WorkoutsListViewModel()
    @State private var activeSession: Session?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Workouts")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { Task { await vm.load() } } label: {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                }
                .navigationDestination(item: $activeSession) { session in
                    // We pass the whole workout so the active view knows targets.
                    if case .loaded(let workouts) = vm.state,
                       let w = workouts.first(where: { $0.id == session.workoutId }) {
                        SessionActiveView(session: session, workout: w)
                    } else {
                        SessionActiveView(session: session, workout: nil)
                    }
                }
                .task {
                    if case .idle = vm.state { await vm.load() }
                }
        }
    }

    @ViewBuilder private var content: some View {
        switch vm.state {
        case .idle, .loading:
            ProgressView("Loading…")
        case .failed(let msg):
            ContentUnavailableView {
                Label("Couldn't load workouts", systemImage: "wifi.exclamationmark")
            } description: {
                Text(msg)
            } actions: {
                Button("Retry") { Task { await vm.load() } }
            }
        case .loaded(let workouts):
            if workouts.isEmpty {
                ContentUnavailableView("No Workouts",
                    systemImage: "dumbbell",
                    description: Text("Create a workout template on the web dashboard."))
            } else {
                List(workouts) { w in
                    WorkoutRow(workout: w, isStarting: vm.startingWorkoutId == w.id) {
                        await start(w)
                    }
                }
                .refreshable { await vm.load() }
            }
        }
    }

    private func start(_ workout: Workout) async {
        vm.startingWorkoutId = workout.id
        defer { vm.startingWorkoutId = nil }
        let clientId = UUID().uuidString
        let body = CreateSessionBody(
            workoutId: workout.id,
            name: workout.name,
            source: "ios",
            bodyweightKg: settings.bodyweightKg,
            readinessScore: nil,
            clientId: clientId,     // idempotent: a retry can't create a duplicate session
            startedAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
        do {
            let session = try await APIClient.shared.startSession(body)
            activeSession = session
        } catch {
            // Surface via alert-ish inline state.
            vm.state = .failed((error as? APIError)?.errorDescription ?? error.localizedDescription)
        }
    }
}

private struct WorkoutRow: View {
    let workout: Workout
    let isStarting: Bool
    let onStart: () async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(workout.name).font(.headline)
                    if let notes = workout.notes, !notes.isEmpty {
                        Text(notes).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
                Spacer()
                Button {
                    Task { await onStart() }
                } label: {
                    if isStarting { ProgressView() }
                    else { Label("Start", systemImage: "play.fill") }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isStarting)
            }
            // Exercise chips.
            let names = workout.exercises
                .sorted { $0.orderIndex < $1.orderIndex }
                .compactMap { $0.exercise?.name }
            if !names.isEmpty {
                Text(names.joined(separator: " · "))
                    .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
            }
        }
        .padding(.vertical, 4)
    }
}
