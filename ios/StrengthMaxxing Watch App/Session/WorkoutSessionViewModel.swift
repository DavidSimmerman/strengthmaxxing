//
//  WorkoutSessionViewModel.swift
//  StrengthMaxxing Watch App
//
//  The brain of the watch app. Orchestrates:
//   - Starting a session (POST /api/sessions).
//   - Walking the workout template exercise-by-exercise, cycling supersets.
//   - Auto rep counting (MotionRepSession) during each set.
//   - Posting each completed set (POST /api/sessions/:id/sets) with repEvents.
//   - Rest timer + looping haptics AFTER the last exercise of a superset group.
//   - The live HKWorkoutSession (heart rate / energy).
//   - Finishing (POST /api/sessions/:id/finish); the watch's live builder saves the
//     HKWorkout to Health, so no separate write is needed here.
//
//  Superset model (per contract): exercises sharing a `supersetGroup` are cycled with no
//  rest between them; rest runs only after the last exercise in the group. We pre-compute
//  an ordered list of "slots"; each slot knows whether rest follows it.
//

import Foundation
import Combine

@MainActor
final class WorkoutSessionViewModel: ObservableObject {

    // MARK: Phases

    enum Phase: Equatable {
        case notStarted
        case starting
        case lifting          // motion counting a set
        case setReview        // set done, confirm/adjust reps before posting
        case resting          // rest countdown / alarm
        case finishing
        case finished
        case error(String)
    }

    // MARK: Published state

    @Published private(set) var phase: Phase = .notStarted
    @Published private(set) var slots: [WorkoutSlot] = []
    @Published private(set) var currentIndex: Int = 0
    @Published private(set) var session: Session?
    /// Working weight for the current slot (editable on the watch).
    @Published var currentWeightKg: Double = 0
    @Published private(set) var lastError: String?

    // Collaborators.
    let motion = MotionRepSession()
    let rest = RestTimer()
    let workout = WatchWorkoutSession()

    private let api = APIClient.shared
    private let settings = AppSettings.shared
    private let workoutTemplate: Workout

    // Timing for the in-progress set.
    private var setStartedAt: Date?

    var currentSlot: WorkoutSlot? {
        guard slots.indices.contains(currentIndex) else { return nil }
        return slots[currentIndex]
    }

    var progressText: String {
        guard !slots.isEmpty else { return "" }
        return "\(min(currentIndex + 1, slots.count)) / \(slots.count)"
    }

    init(workout: Workout) {
        self.workoutTemplate = workout
        self.slots = WorkoutPlanner.buildSlots(from: workout)
    }

    // MARK: - Lifecycle

    func startSession() async {
        phase = .starting
        await workout.requestAuthorization()
        let body = CreateSessionBody(
            workoutId: workoutTemplate.id,
            name: workoutTemplate.name,
            source: "watch",
            bodyweightKg: settings.bodyweightKg,
            readinessScore: nil
        )
        do {
            let created = try await api.startSession(body)
            self.session = created
            self.currentIndex = 0
            self.workout.start()          // live HR/energy
            beginCurrentSet()
        } catch {
            fail(error)
        }
    }

    /// Begin motion counting for the current slot.
    func beginCurrentSet() {
        guard let slot = currentSlot else { return }
        currentWeightKg = slot.targetWeightKg ?? currentWeightKg
        setStartedAt = Date()
        motion.startSet()
        phase = .lifting
    }

    /// User taps "Done" — stop counting and review reps.
    func finishCountingSet() {
        _ = motion.stopSet()
        phase = .setReview
    }

    /// User confirms reps → post the set, then rest (or straight to next superset partner).
    func confirmSet(reps: Int, rpe: Double? = nil, isWarmup: Bool = false) async {
        motion.setCount(reps)
        guard let slot = currentSlot, let session else { return }
        let started = setStartedAt ?? Date()
        let completed = Date()

        let body = CreateSetBody(
            exerciseId: slot.workoutExercise.exerciseId,
            setIndex: slot.setIndex,
            supersetGroup: slot.supersetGroup,
            reps: reps,
            weightKg: currentWeightKg,
            rpe: rpe,
            isWarmup: isWarmup,
            restSecActual: nil,
            startedAt: Int64(started.timeIntervalSince1970 * 1000),
            completedAt: Int64(completed.timeIntervalSince1970 * 1000),
            repEvents: motion.currentRepEvents
        )

        do {
            try await api.postSet(sessionId: session.id, body)
        } catch {
            // Non-fatal: keep going, but surface it. A production app would queue & retry.
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }

        advanceAfterSet(slot: slot)
    }

    /// Decide whether to rest (last of superset / standalone) or jump to the next partner.
    private func advanceAfterSet(slot: WorkoutSlot) {
        let isLast = currentIndex >= slots.count - 1
        if isLast {
            Task { await finish() }
            return
        }
        if slot.restAfter {
            phase = .resting
            rest.start(seconds: slot.restSec)
        } else {
            // Superset partner next — no rest, straight into the next set.
            currentIndex += 1
            beginCurrentSet()
        }
    }

    /// Called when the user dismisses the rest alarm (or skips rest).
    func endRestAndAdvance() {
        rest.stop()
        guard currentIndex < slots.count - 1 else {
            Task { await finish() }
            return
        }
        currentIndex += 1
        beginCurrentSet()
    }

    /// Skip the current slot without recording a set.
    func skipSlot() {
        _ = motion.stopSet()
        rest.stop()
        if currentIndex < slots.count - 1 {
            currentIndex += 1
            beginCurrentSet()
        } else {
            Task { await finish() }
        }
    }

    // MARK: - Finish

    func finish() async {
        phase = .finishing
        _ = motion.stopSet()
        rest.stop()

        // Finalize the live HKWorkout on the watch (saves to Health / rings).
        _ = await workout.end()

        guard let session else { phase = .finished; return }
        let body = FinishSessionBody(notes: nil, bodyweightKg: settings.bodyweightKg)
        do {
            let finalized = try await api.finishSession(id: session.id, body)
            self.session = finalized
        } catch {
            lastError = (error as? APIError)?.errorDescription ?? error.localizedDescription
        }
        phase = .finished
    }

    func cancelSession() {
        motion.stopSet()
        rest.stop()
        workout.discard()
        phase = .finished
    }

    private func fail(_ error: Error) {
        let msg = (error as? APIError)?.errorDescription ?? error.localizedDescription
        lastError = msg
        phase = .error(msg)
    }
}
