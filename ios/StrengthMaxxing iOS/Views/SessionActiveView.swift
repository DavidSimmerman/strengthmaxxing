//
//  SessionActiveView.swift
//  StrengthMaxxing iOS
//
//  Active session on the phone (manual logging; the watch is the auto-counting star).
//   - Tap a planned set to log reps + weight (lb/kg at the edge, kg on the wire).
//   - Logged sets: tap to edit (PATCH), swipe to delete (DELETE).
//   - End Workout (with confirmation) any time: finishes with what's logged, then writes
//     the HKWorkout to Apple Health.
//

import SwiftUI

@MainActor
final class PhoneSessionViewModel: ObservableObject {
    @Published var session: Session
    @Published var loggedSets: [WorkoutSet] = []
    @Published var isFinishing = false
    @Published var isLogging = false
    @Published var errorMessage: String?
    @Published var finished = false

    let workout: Workout?
    let slots: [WorkoutSlot]
    private let api = APIClient.shared
    private let health = HealthKitManager.shared
    private let settings = AppSettings.shared

    let startedAt = Date()
    private var lastCompletedAt: Date?

    init(session: Session, workout: Workout?) {
        self.session = session
        self.workout = workout
        self.slots = workout.map { WorkoutPlanner.buildSlots(from: $0) } ?? []
    }

    var unit: WeightUnit { settings.units }

    /// Last weight used for an exercise in this session, else the template target.
    func defaultWeightKg(for slot: WorkoutSlot) -> Double {
        loggedSets.last(where: { $0.exerciseId == slot.exerciseId })?.weightKg ?? slot.targetWeightKg ?? 20
    }

    func logSet(slot: WorkoutSlot, reps: Int, weightKg: Double, rpe: Double?, isWarmup: Bool) async {
        guard reps > 0 else { return }          // 0 reps = skipped, never posted
        guard !isLogging else { return }
        isLogging = true
        defer { isLogging = false }
        let now = Date()
        let started = now.addingTimeInterval(-Double(reps) * 3)
        let body = CreateSetBody(
            exerciseId: slot.exerciseId,
            setIndex: slot.setIndex,
            supersetGroup: slot.supersetGroup,
            reps: reps,
            weightKg: weightKg,
            rpe: rpe,
            isWarmup: isWarmup,
            restSecActual: lastCompletedAt.map { max(0, Int(started.timeIntervalSince($0))) },
            startedAt: Int64(started.timeIntervalSince1970 * 1000),
            completedAt: Int64(now.timeIntervalSince1970 * 1000),
            repEvents: RepEvent.adjust([], to: reps, fallbackSpacingMs: 3000),
            clientId: UUID().uuidString
        )
        do {
            let created = try await api.postSet(sessionId: session.id, body)
            loggedSets.append(created)
            lastCompletedAt = now
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func update(_ set: WorkoutSet, reps: Int, weightKg: Double, rpe: Double?, isWarmup: Bool) async {
        do {
            let updated = try await api.updateSet(
                sessionId: session.id, setId: set.id,
                UpdateSetBody(reps: reps, weightKg: weightKg, rpe: rpe, isWarmup: isWarmup)
            )
            if let i = loggedSets.firstIndex(where: { $0.id == set.id }) {
                var merged = updated
                if merged.exercise == nil { merged.exercise = set.exercise }  // PATCH may omit the join
                loggedSets[i] = merged
            }
            errorMessage = nil
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func delete(_ set: WorkoutSet) async {
        do {
            try await api.deleteSet(sessionId: session.id, setId: set.id)
            loggedSets.removeAll { $0.id == set.id }
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func finish() async {
        guard !isFinishing else { return }
        isFinishing = true
        defer { isFinishing = false }
        let body = FinishSessionBody(notes: nil, bodyweightKg: settings.bodyweightKg)
        do {
            let finalized = try await api.finishSession(id: session.id, body)
            self.session = finalized
            try? await health.saveStrengthWorkout(for: finalized, fallbackStart: startedAt, fallbackEnd: Date())
            finished = true
        } catch {
            errorMessage = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
    }

    func isLogged(_ slot: WorkoutSlot) -> Bool {
        loggedSets.contains { $0.exerciseId == slot.exerciseId && $0.setIndex == slot.setIndex }
    }

    func exerciseName(_ set: WorkoutSet) -> String {
        set.exercise?.name
            ?? workout?.exercises.first(where: { $0.exerciseId == set.exerciseId })?.exercise?.name
            ?? "Exercise \(set.exerciseId)"
    }

    func category(for exerciseId: Int) -> String? {
        workout?.exercises.first(where: { $0.exerciseId == exerciseId })?.exercise?.category
    }
}

struct SessionActiveView: View {
    @StateObject private var vm: PhoneSessionViewModel
    @EnvironmentObject var settings: AppSettings
    @Environment(\.dismiss) private var dismiss
    @State private var entrySlot: WorkoutSlot?
    @State private var editingSet: WorkoutSet?
    @State private var confirmEnd = false

    init(session: Session, workout: Workout?) {
        _vm = StateObject(wrappedValue: PhoneSessionViewModel(session: session, workout: workout))
    }

    var body: some View {
        List {
            if !vm.slots.isEmpty {
                Section {
                    ForEach(vm.slots) { slot in
                        Button { entrySlot = slot } label: {
                            SlotRow(slot: slot, done: vm.isLogged(slot), unit: settings.units)
                        }
                        .buttonStyle(.plain)
                    }
                } header: {
                    Text(vm.workout?.name ?? vm.session.name ?? "Session")
                } footer: {
                    Text("Tap a set to log it. Supersets are grouped; rest applies after the last exercise in a group.")
                }
            }

            if !vm.loggedSets.isEmpty {
                Section("Logged") {
                    ForEach(vm.loggedSets) { set in
                        Button { editingSet = set } label: {
                            LoggedSetRow(name: vm.exerciseName(set), set: set, unit: settings.units)
                        }
                        .buttonStyle(.plain)
                    }
                    .onDelete { offsets in
                        let targets = offsets.map { vm.loggedSets[$0] }
                        Task { for s in targets { await vm.delete(s) } }
                    }
                }
            }

            Section {
                Button(role: .destructive) {
                    confirmEnd = true
                } label: {
                    HStack {
                        if vm.isFinishing { ProgressView() }
                        Text("End Workout").frame(maxWidth: .infinity)
                    }
                }
                .disabled(vm.isFinishing)
            } footer: {
                if let err = vm.errorMessage {
                    Text(err).foregroundStyle(.red)
                }
            }
        }
        .navigationTitle("Active Session")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("End workout?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End & Save to Health", role: .destructive) {
                Task {
                    await vm.finish()
                    if vm.finished { dismiss() }
                }
            }
            Button("Keep Going", role: .cancel) {}
        } message: {
            Text("Finishes with the \(vm.loggedSets.count) set(s) logged so far.")
        }
        .sheet(item: $entrySlot) { slot in
            SetEntrySheet(
                title: slot.exercise?.name ?? "Log Set",
                category: slot.exercise?.category,
                unit: settings.units,
                initialReps: slot.targetReps ?? 8,
                initialWeightKg: vm.defaultWeightKg(for: slot),
                initialRPE: nil,
                initialWarmup: false,
                confirmTitle: "Log"
            ) { reps, weight, rpe, warmup in
                Task { await vm.logSet(slot: slot, reps: reps, weightKg: weight, rpe: rpe, isWarmup: warmup) }
            }
        }
        .sheet(item: $editingSet) { set in
            SetEntrySheet(
                title: "Edit \(vm.exerciseName(set))",
                category: vm.category(for: set.exerciseId),
                unit: settings.units,
                initialReps: set.reps,
                initialWeightKg: set.weightKg,
                initialRPE: set.rpe,
                initialWarmup: set.isWarmup ?? false,
                confirmTitle: "Save"
            ) { reps, weight, rpe, warmup in
                Task {
                    if reps == 0 { await vm.delete(set) }
                    else { await vm.update(set, reps: reps, weightKg: weight, rpe: rpe, isWarmup: warmup) }
                }
            }
        }
    }
}

private struct SlotRow: View {
    let slot: WorkoutSlot
    let done: Bool
    let unit: WeightUnit

    var body: some View {
        HStack {
            Image(systemName: done ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(done ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(slot.exercise?.name ?? "Exercise \(slot.exerciseId)")
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
        if let w = slot.targetWeightKg { parts.append(Units.format(kg: w, unit: unit)) }
        parts.append(slot.restAfter ? "rest \(slot.restSec)s" : "→ superset")
        return parts.joined(separator: " · ")
    }
}

private struct LoggedSetRow: View {
    let name: String
    let set: WorkoutSet
    let unit: WeightUnit

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(name).font(.subheadline).bold()
            HStack(spacing: 8) {
                Text("\(set.reps) × \(Units.format(kg: set.weightKg, unit: unit))")
                if let rpe = set.rpe { Text("RPE \(Units.formatNumber(rpe))") }
                if set.isWarmup == true { Text("warm-up").italic() }
            }
            .font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Reps / weight (display units, snapping steppers) / optional RPE / warm-up.
private struct SetEntrySheet: View {
    let title: String
    let category: String?
    let unit: WeightUnit
    let confirmTitle: String
    let onConfirm: (_ reps: Int, _ weightKg: Double, _ rpe: Double?, _ warmup: Bool) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reps: Int
    @State private var weightKg: Double
    @State private var useRPE: Bool
    @State private var rpe: Double
    @State private var warmup: Bool

    init(title: String, category: String?, unit: WeightUnit, initialReps: Int, initialWeightKg: Double,
         initialRPE: Double?, initialWarmup: Bool, confirmTitle: String,
         onConfirm: @escaping (Int, Double, Double?, Bool) -> Void) {
        self.title = title
        self.category = category
        self.unit = unit
        self.confirmTitle = confirmTitle
        self.onConfirm = onConfirm
        _reps = State(initialValue: initialReps)
        _weightKg = State(initialValue: initialWeightKg)
        _useRPE = State(initialValue: initialRPE != nil)
        _rpe = State(initialValue: initialRPE ?? 8)
        _warmup = State(initialValue: initialWarmup)
    }

    private var weightText: Binding<Double> {
        Binding(
            get: { Units.displayRounded(kg: weightKg, unit: unit) },
            set: { weightKg = Units.toKg($0, unit: unit) }
        )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Stepper("Reps: \(reps)", value: $reps, in: 0...100)
                    HStack {
                        Text("Weight")
                        Spacer()
                        Button { weightKg = Units.stepped(kg: weightKg, direction: -1, category: category, unit: unit) } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.borderless)
                        TextField(unit.symbol, value: weightText, format: .number)
                            .keyboardType(.decimalPad)
                            .multilineTextAlignment(.trailing)
                            .frame(width: 70)
                        Text(unit.symbol).foregroundStyle(.secondary)
                        Button { weightKg = Units.stepped(kg: weightKg, direction: 1, category: category, unit: unit) } label: {
                            Image(systemName: "plus.circle")
                        }
                        .buttonStyle(.borderless)
                    }
                    Toggle("RPE", isOn: $useRPE)
                    if useRPE {
                        VStack(alignment: .leading) {
                            Text("RPE \(Units.formatNumber(rpe))")
                            Slider(value: $rpe, in: 5...10, step: 0.5)
                        }
                    }
                    Toggle("Warm-up set", isOn: $warmup)
                } footer: {
                    if reps == 0 { Text("0 reps = skipped (not saved).") }
                }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(confirmTitle) {
                        onConfirm(reps, weightKg, useRPE ? rpe : nil, warmup)
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}
