//
//  ActiveSessionView.swift
//  StrengthMaxxing Watch App
//
//  Live session UI, switched by phase:
//   - lifting:   big auto rep count (starts after 2 reps), effort meter, Done
//   - setReview: confirm/adjust reps + weight (lb/kg), optional RPE, Log Set / Skip
//   - resting:   countdown ring → alarm (Dismiss = snooze, Go) → "over rest" timer
//   - finished:  summary
//  An End Workout button (with confirmation) is in the toolbar the whole time.
//

import SwiftUI

struct ActiveSessionView: View {
    @StateObject var viewModel: WorkoutSessionViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State var confirmEnd = false   // not private: keeps the memberwise init internal

    var body: some View {
        Group {
            switch viewModel.phase {
            case .notStarted:
                ProgressView()
            case .lifting:
                LiftingView(viewModel: viewModel)
            case .setReview:
                SetReviewView(viewModel: viewModel)
            case .resting:
                RestingView(viewModel: viewModel, rest: viewModel.rest)
            case .finishing:
                VStack(spacing: 8) { ProgressView(); Text("Finishing…") }
            case .finished:
                FinishedView(viewModel: viewModel, onDone: { dismiss() })
            }
        }
        .navigationBarBackButtonHidden(viewModel.phase != .finished)
        .toolbar {
            if viewModel.phase != .finished && viewModel.phase != .finishing {
                ToolbarItem(placement: .topBarLeading) {
                    Button(role: .destructive) { confirmEnd = true } label: {
                        Image(systemName: "xmark")
                    }
                    .accessibilityLabel("End Workout")
                }
            }
        }
        .confirmationDialog("End workout?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End Workout", role: .destructive) {
                Task { await viewModel.finish() }
            }
            Button("Keep Going", role: .cancel) {}
        } message: {
            Text("Saves the \(viewModel.logged.count) set(s) logged so far.")
        }
        .onAppear { viewModel.start() }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active { viewModel.rest.refresh() }
        }
    }
}

// MARK: - Lifting

private struct LiftingView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    @ObservedObject private var motion: MotionRepSession
    @ObservedObject private var workout: WatchWorkoutSession

    init(viewModel: WorkoutSessionViewModel) {
        self.viewModel = viewModel
        self.motion = viewModel.motion
        self.workout = viewModel.workout
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 4) {
                HStack {
                    Text(viewModel.progressText).font(.caption2).foregroundStyle(.secondary)
                    Spacer()
                    if workout.heartRate > 0 {
                        Label("\(Int(workout.heartRate))", systemImage: "heart.fill")
                            .font(.caption2).foregroundStyle(.red)
                    }
                }
                Text(viewModel.currentSlot?.exercise?.name ?? "Set")
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.6)
                Text(viewModel.weightText(viewModel.currentWeightKg))
                    .font(.caption).foregroundStyle(.secondary)

                if viewModel.isOffWrist {
                    OffWristView(viewModel: viewModel)
                } else {
                    if let side = viewModel.currentSlot?.side {
                        Text("\(viewModel.sideName(side)) arm").font(.caption2).foregroundStyle(.secondary)
                    }
                    Text(motion.isSetStarted ? "\(motion.repCount)" : "–")
                        .font(.system(size: 56, weight: .bold, design: .rounded))
                        .contentTransition(.numericText(value: Double(motion.repCount)))
                        .monospacedDigit()
                    Text(motion.isSetStarted ? "reps" : "counting starts after 2 reps")
                        .font(.caption2).foregroundStyle(.secondary)

                    EffortMeter(value: motion.effort)
                        .frame(height: 6)
                        .padding(.horizontal, 12)

                    Button {
                        viewModel.finishCounting()
                    } label: {
                        Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }

                Button("Skip set") { viewModel.skipSlot() }
                    .font(.caption2).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 6)
        }
    }
}

/// The arm without the watch: nothing to count, so a timer and a Done button.
private struct OffWristView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel

    var body: some View {
        let side = viewModel.sideName(viewModel.currentSlot?.side)
        VStack(spacing: 4) {
            Label("No watch on this arm", systemImage: "hand.raised")
                .font(.caption2).foregroundStyle(.orange)
            TimelineView(.periodic(from: .now, by: 1)) { ctx in
                let sec = max(0, Int(ctx.date.timeIntervalSince(viewModel.currentSetStartedAt)))
                Text(String(format: "%d:%02d", sec / 60, sec % 60))
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
            Text("\(side) arm").font(.caption2).foregroundStyle(.secondary)
            Button {
                viewModel.finishCounting()
            } label: {
                Label("\(side) done", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
    }
}

private struct EffortMeter: View {
    let value: Double  // 0…1
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(.gray.opacity(0.25))
                Capsule().fill(.green)
                    .frame(width: geo.size.width * min(max(value, 0), 1))
            }
        }
    }
}

// MARK: - Set review

private struct SetReviewView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    @State private var reps: Int
    @State private var useRPE = false
    @State private var rpe: Double = 8
    @State private var isWarmup = false

    init(viewModel: WorkoutSessionViewModel) {
        self.viewModel = viewModel
        _reps = State(initialValue: viewModel.reviewReps)
    }

    private var category: String? { viewModel.currentSlot?.exercise?.category }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Text(viewModel.currentSlot?.exercise?.name ?? "Set")
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.6)

                Stepper(value: $reps, in: 0...100) {
                    HStack {
                        Text("Reps"); Spacer()
                        Text("\(reps)").bold()
                        if reps != viewModel.reviewReps {
                            Image(systemName: "pencil").font(.caption2).foregroundStyle(.orange)
                        }
                    }
                }

                Stepper {
                    HStack {
                        Text("Weight"); Spacer()
                        Text(viewModel.weightText(viewModel.currentWeightKg)).bold()
                    }
                } onIncrement: {
                    viewModel.stepWeight(1)
                } onDecrement: {
                    viewModel.stepWeight(-1)
                }

                Toggle("RPE", isOn: $useRPE).font(.caption)
                if useRPE {
                    VStack(alignment: .leading) {
                        Text("RPE \(Units.formatNumber(rpe))").font(.caption)
                        Slider(value: $rpe, in: 5...10, step: 0.5)
                    }
                }
                Toggle("Warm-up", isOn: $isWarmup).font(.caption)

                Button {
                    let r = reps, p: Double? = useRPE ? rpe : nil, w = isWarmup
                    Task { await viewModel.logSet(reps: r, rpe: p, isWarmup: w) }
                } label: {
                    if viewModel.isLogging {
                        ProgressView()
                    } else {
                        Label(reps == 0 ? "Skip (0 reps)" : "Log Set", systemImage: "checkmark")
                            .frame(maxWidth: .infinity)
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(viewModel.isLogging)

                if reps != viewModel.reviewReps && reps > 0 {
                    Text("Counter will learn from this correction.")
                        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 4)
        }
    }
}

// MARK: - Resting + alarm

private struct RestingView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    @ObservedObject var rest: RestAlarmController

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                switch rest.phase {
                case .alarming:
                    Text("REST OVER").font(.headline).foregroundStyle(.orange)
                    Image(systemName: "bell.and.waves.left.and.right.fill")
                        .font(.system(size: 34)).foregroundStyle(.orange)
                        .symbolEffect(.pulse)
                    Text("+\(clock(rest.overRest)) over").font(.caption).monospacedDigit()
                    Button {
                        rest.dismiss()
                    } label: {
                        Label("Dismiss", systemImage: "bell.slash.fill").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent).tint(.red)
                    goButton
                case .snoozed:
                    Text("+\(clock(rest.overRest))")
                        .font(.system(size: 34, weight: .bold, design: .rounded)).monospacedDigit()
                        .foregroundStyle(.orange)
                    Text("over rest · buzz again in \(clock(rest.snoozeRemaining))")
                        .font(.caption2).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    goButton
                default:
                    ZStack {
                        Circle().stroke(.gray.opacity(0.25), lineWidth: 8)
                        Circle()
                            .trim(from: 0, to: rest.progress)
                            .stroke(.blue, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .animation(.linear(duration: 0.25), value: rest.progress)
                        VStack {
                            Text(clock(rest.remaining))
                                .font(.system(size: 30, weight: .bold, design: .rounded))
                                .monospacedDigit()
                            Text("rest").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    .frame(width: 110, height: 110)
                    HStack {
                        Button("+30s") { rest.adjust(by: 30) }.font(.caption)
                        Button("Go") { viewModel.startNextSetNow() }.font(.caption)
                    }
                }
                if let next = viewModel.nextSlot {
                    Text("Next: \(next.exercise?.name ?? "set")")
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                    Text("Starts automatically when you begin lifting")
                        .font(.system(size: 10)).foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 4)
        }
    }

    private var goButton: some View {
        Button {
            viewModel.startNextSetNow()
        } label: {
            Label("Go", systemImage: "play.fill").frame(maxWidth: .infinity)
        }
    }

    private func clock(_ seconds: Double) -> String {
        let s = Int(seconds.rounded(.up))
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}

// MARK: - Finished

private struct FinishedView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    @ObservedObject var sync = SyncService.shared
    let onDone: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 36)).foregroundStyle(.green)
                Text("Done!").font(.headline)
                Text("\(viewModel.logged.count) sets · \(viewModel.weightText(viewModel.totalVolumeKg))")
                    .font(.caption)
                if sync.pendingCount > 0 {
                    Label("\(sync.pendingCount) waiting to sync", systemImage: "icloud.and.arrow.up")
                        .font(.caption2).foregroundStyle(.orange)
                } else {
                    Label("Synced", systemImage: "checkmark.icloud")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                Button("Close", action: onDone).buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }
}
