//
//  SessionActiveView.swift
//  StrengthMaxxing iOS
//
//  Active-session view on the phone. The watch is the star for auto rep counting; on the
//  phone the user logs sets manually (reps/weight/RPE) as they go. Each logged set is
//  POSTed to /api/sessions/:id/sets. On finish we POST /finish and then write an HKWorkout
//  to HealthKit using the finish response's energy + timestamps.
//
//  Superset handling mirrors the watch: exercises sharing a supersetGroup are cycled and
//  the "rest" hint is only shown after the last exercise of the group. On the phone we
//  don't run a haptic alarm (that's the watch's role) but we do show a rest suggestion.
//

import SwiftUI

@MainActor
final class PhoneSessionViewModel: ObservableObject {
    @Published var session: Session
    @Published var loggedSets: [WorkoutSet] = []
    @Published var isFinishing = false
    @Published var finishError: String?
    @Published var finished = false

    let workout: Workout?
    private let api = APIClient.shared
    private let health = HealthKitManager.shared
    private let settings = AppSettings.shared

    /// Wall-clock start for the HealthKit fallback window.
    let startedAt = Date()

    init(session: Session, workout: Workout?) {
        self.session = session
        self.workout = workout
    }

    /// Ordered slots (superset-aware), reusing the watch planner for identical behavior.
    var slots: [WorkoutSlot] {
        guard let workout else { return [] }
        return WorkoutPlanner.buildSlots(from: workout)
    }

    func logSet(slot: WorkoutSlot,
                reps: Int, weightKg: Double, rpe: Double?, isWarmup: Bool) async {
        let now = Date()
        // Phone-entered sets have a single synthetic rep-event stream (even spacing) so the
        // server still receives repEvents; the watch provides true per-rep timing.
        let events = (0..<max(reps, 0)).map { i in
            RepEvent(repIndex: i, offsetMs: i * 2000)
        }
        let body = CreateSetBody(
            exerciseId: slot.workoutExercise.exerciseId,
            setIndex: slot.setIndex,
            supersetGroup: slot.supersetGroup,
            reps: reps,
            weightKg: weightKg,
            rpe: rpe,
            isWarmup: isWarmup,
            restSecActual: nil,
            startedAt: Int64(now.addingTimeInterval(-Double(reps) * 2).timeIntervalSince1970 * 1000),
            completedAt: Int64(now.timeIntervalSince1970 * 1000),
            repEvents: events
        )
        do {
            let created = try await api.postSet(sessionId: session.id, body)
            loggedSets.append(created)
        } catch {
            finishError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func finish(notes: String?) async {
        isFinishing = true
        defer { isFinishing = false }
        let body = FinishSessionBody(notes: notes, bodyweightKg: settings.bodyweightKg)
        do {
            let finalized = try await api.finishSession(id: session.id, body)
            self.session = finalized
            // Write to HealthKit (Apple Fitness) using the finish response.
            try? await health.saveStrengthWorkout(
                for: finalized, fallbackStart: startedAt, fallbackEnd: Date()
            )
            finished = true
        } catch {
            finishError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func setsLogged(for slot: WorkoutSlot) -> Bool {
        loggedSets.contains {
            $0.exerciseId == slot.workoutExercise.exerciseId && $0.setIndex == slot.setIndex
        }
    }
}

struct SessionActiveView: View {
    @StateObject private var vm: PhoneSessionViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var entrySlot: WorkoutSlot?

    init(session: Session, workout: Workout?) {
        _vm = StateObject(wrappedValue: PhoneSessionViewModel(session: session, workout: workout))
    }

    var body: some View {
        List {
            Section {
                ForEach(vm.slots) { slot in
                    Button {
                        entrySlot = slot
                    } label: {
                        SlotRow(slot: slot, done: vm.setsLogged(for: slot))
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text(vm.workout?.name ?? vm.session.name ?? "Session")
            } footer: {
                Text("Tap a set to log reps & weight. Supersets are grouped; rest applies after the last exercise in a group.")
            }

            Section {
                Button {
                    Task {
                        await vm.finish(notes: nil)
                        if vm.finished { dismiss() }
                    }
                } label: {
                    HStack {
                        if vm.isFinishing { ProgressView() }
                        Text("Finish & Save to Health").frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(vm.isFinishing)
            } footer: {
                if let err = vm.finishError {
                    Text(err).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Active Session")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $entrySlot) { slot in
            SetEntrySheet(slot: slot) { reps, weight, rpe, warmup in
                Task { await vm.logSet(slot: slot, reps: reps, weightKg: weight, rpe: rpe, isWarmup: warmup) }
                entrySlot = nil
            }
        }
    }
}

private struct SlotRow: View {
    let slot: WorkoutSlot
    let done: Bool

    var body: some View {
        HStack {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(slot.exercise?.name ?? "Exercise \(slot.workoutExercise.exerciseId)")
                        .font(.body)
                    if let g = slot.supersetGroup {
                        Text("SS\(g)")
                            .font(.caption2).bold()
                            .padding(.horizontal, 5).padding(.vertical, 1)
                            .background(.orange.opacity(0.2), in: Capsule())
                            .foregroundStyle(.orange)
                    }
                }
                Text(subtitle).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Text("Set \(slot.setIndex + 1)").font(.caption2).foregroundStyle(.secondary)
        }
    }

    private var subtitle: String {
        var parts: [String] = []
        if let r = slot.targetReps { parts.append("\(r) reps") }
        if let w = slot.targetWeightKg { parts.append(String(format: "%.1f kg", w)) }
        if slot.restAfter { parts.append("rest \(slot.restSec)s") }
        else { parts.append("→ superset") }
        return parts.joined(separator: " · ")
    }
}

private struct SetEntrySheet: View {
    let slot: WorkoutSlot
    let onLog: (_ reps: Int, _ weight: Double, _ rpe: Double?, _ warmup: Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reps: Int
    @State private var weight: Double
    @State private var rpe: Double = 8
    @State private var warmup = false

    init(slot: WorkoutSlot,
         onLog: @escaping (Int, Double, Double?, Bool) -> Void) {
        self.slot = slot
        self.onLog = onLog
        _reps = State(initialValue: slot.targetReps ?? 8)
        _weight = State(initialValue: slot.targetWeightKg ?? 20)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper("Reps: \(reps)", value: $reps, in: 0...100)
                    HStack {
                        Text("Weight")
                        Spacer()
                        TextField("kg", value: $weight, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 90)
                        Text("kg").foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading) {
                        Text("RPE \(String(format: "%.1f", rpe))")
                        Slider(value: $rpe, in: 5...10, step: 0.5)
                    }
                    Toggle("Warm-up set", isOn: $warmup)
                }
            }
            .navigationTitle(slot.exercise?.name ?? "Log Set")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Log") { onLog(reps, weight, rpe, warmup) }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
