//
//  ActiveSessionView.swift
//  StrengthMaxxing Watch App
//
//  The live session UI. Switches sub-views by the view model's phase:
//   - lifting: big auto rep count + effort meter + Done
//   - setReview: confirm/adjust reps + weight, then post
//   - resting: countdown ring; when alarming, a prominent Stop button silences haptics
//   - finished: summary
//

import SwiftUI

struct ActiveSessionView: View {
    @StateObject var viewModel: WorkoutSessionViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            switch viewModel.phase {
            case .notStarted, .starting:
                StartingView(viewModel: viewModel)
            case .lifting:
                LiftingView(viewModel: viewModel)
            case .setReview:
                SetReviewView(viewModel: viewModel)
            case .resting:
                RestingView(viewModel: viewModel)
            case .finishing:
                VStack(spacing: 8) { ProgressView(); Text("Finishing…") }
            case .finished:
                FinishedView(viewModel: viewModel, onDone: { dismiss() })
            case .error(let msg):
                ErrorView(message: msg, onDismiss: { dismiss() })
            }
        }
        .navigationBarBackButtonHidden(viewModel.phase != .finished)
    }
}

// MARK: - Starting

private struct StartingView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    var body: some View {
        VStack(spacing: 10) {
            if viewModel.phase == .starting {
                ProgressView()
                Text("Starting…")
            } else {
                Text("\(viewModel.slots.count) sets")
                    .font(.headline)
                Button {
                    Task { await viewModel.startSession() }
                } label: {
                    Label("Start", systemImage: "play.fill")
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .task {
            // Auto-start on appear if not started.
            if viewModel.phase == .notStarted { await viewModel.startSession() }
        }
    }
}

// MARK: - Lifting (auto rep count)

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

            // Big auto rep count.
            Text("\(motion.repCount)")
                .font(.system(size: 56, weight: .bold, design: .rounded))
                .contentTransition(.numericText(value: Double(motion.repCount)))
                .monospacedDigit()
            Text("reps").font(.caption2).foregroundStyle(.secondary)

            // Effort meter (live userAcceleration magnitude).
            EffortMeter(value: motion.effort)
                .frame(height: 6)
                .padding(.horizontal, 12)

            Button {
                viewModel.finishCountingSet()
            } label: {
                Label("Done", systemImage: "checkmark").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .tint(.green)
        }
        .padding(.horizontal, 6)
    }
}

private struct EffortMeter: View {
    let value: Double  // g
    var body: some View {
        GeometryReader { geo in
            let clamped = min(max(value / 1.0, 0), 1)  // 0..1 g mapped to full width
            ZStack(alignment: .leading) {
                Capsule().fill(.gray.opacity(0.25))
                Capsule().fill(.green)
                    .frame(width: geo.size.width * clamped)
            }
        }
    }
}

// MARK: - Set review / confirm

private struct SetReviewView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    @State private var reps: Int
    @State private var rpe: Double = 8
    @State private var isWarmup = false

    init(viewModel: WorkoutSessionViewModel) {
        self.viewModel = viewModel
        _reps = State(initialValue: viewModel.motion.repCount)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                Text(viewModel.currentSlot?.exercise?.name ?? "Set")
                    .font(.headline).lineLimit(1).minimumScaleFactor(0.6)

                Stepper(value: $reps, in: 0...100) {
                    HStack { Text("Reps"); Spacer(); Text("\(reps)").bold() }
                }

                Stepper(value: $viewModel.currentWeightKg, in: 0...500, step: 2.5) {
                    HStack {
                        Text("Weight"); Spacer()
                        Text(String(format: "%.1f kg", viewModel.currentWeightKg)).bold()
                    }
                }

                VStack(alignment: .leading) {
                    Text("RPE \(String(format: "%.0f", rpe))").font(.caption)
                    Slider(value: $rpe, in: 5...10, step: 0.5)
                }

                Toggle("Warm-up", isOn: $isWarmup).font(.caption)

                Button {
                    Task { await viewModel.confirmSet(reps: reps, rpe: rpe, isWarmup: isWarmup) }
                } label: {
                    Label("Log Set", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)

                Button("Skip") { viewModel.skipSlot() }
                    .font(.caption).foregroundStyle(.secondary)
            }
            .padding(.horizontal, 4)
        }
    }
}

// MARK: - Resting + alarm

private struct RestingView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    @ObservedObject private var rest: RestTimer

    init(viewModel: WorkoutSessionViewModel) {
        self.viewModel = viewModel
        self.rest = viewModel.rest
    }

    var body: some View {
        VStack(spacing: 10) {
            if rest.state == .alarming {
                Text("REST DONE")
                    .font(.headline).foregroundStyle(.orange)
                Image(systemName: "bell.fill")
                    .font(.system(size: 40))
                    .foregroundStyle(.orange)
                    .symbolEffect(.pulse)
                Button {
                    viewModel.endRestAndAdvance()
                } label: {
                    Label("Stop", systemImage: "stop.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            } else {
                ZStack {
                    Circle().stroke(.gray.opacity(0.25), lineWidth: 8)
                    Circle()
                        .trim(from: 0, to: rest.progress)
                        .stroke(.blue, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .animation(.linear(duration: 0.25), value: rest.progress)
                    VStack {
                        Text(timeString(rest.remaining))
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        Text("rest").font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .frame(width: 120, height: 120)

                HStack {
                    Button("+30s") { rest.adjust(by: 30) }.font(.caption)
                    Button("Skip") { viewModel.endRestAndAdvance() }.font(.caption)
                }
            }
        }
        .padding()
    }

    private func timeString(_ s: Int) -> String {
        String(format: "%d:%02d", s / 60, s % 60)
    }
}

// MARK: - Finished

private struct FinishedView: View {
    @ObservedObject var viewModel: WorkoutSessionViewModel
    let onDone: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 40)).foregroundStyle(.green)
                Text("Done!").font(.headline)
                if let s = viewModel.session {
                    if let v = s.totalVolumeKg {
                        Text(String(format: "Volume %.0f kg", v)).font(.caption)
                    }
                    if let k = s.estimatedKcal {
                        Text(String(format: "%.0f kcal", k)).font(.caption)
                    }
                }
                if let err = viewModel.lastError {
                    Text(err).font(.caption2).foregroundStyle(.orange)
                }
                Button("Close", action: onDone).buttonStyle(.borderedProminent)
            }
            .padding()
        }
    }
}

private struct ErrorView: View {
    let message: String
    let onDismiss: () -> Void
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 34)).foregroundStyle(.orange)
            Text(message).font(.caption).multilineTextAlignment(.center)
            Button("Back", action: onDismiss)
        }.padding()
    }
}
