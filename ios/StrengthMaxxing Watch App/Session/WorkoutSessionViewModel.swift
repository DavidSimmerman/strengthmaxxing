//
//  WorkoutSessionViewModel.swift
//  StrengthMaxxing Watch App
//
//  The brain of the watch app.
//
//   - Works fully offline: the session is created locally (clientId UUID) and every write
//     goes through the ordered outbox (SyncService). The HKWorkoutSession starts
//     regardless of network.
//   - Motion runs for the whole workout. The counter declares a set started after 2
//     consistent reps — during rest that stops the rest alarm and jumps straight into
//     counting the next set (already at 2).
//   - Log Set: 0 reps = skipped (not posted); a corrected count teaches the counter for
//     that exercise (CalibrationStore); raw motion is queued as a trace when corrected or
//     when "Record motion" is on.
//   - Supersets: no rest between members; rest after the last member of each round.
//   - End Workout at any time finishes with what's logged.
//   - One-side-at-a-time exercises: the watch knows which wrist it's on. It counts the watch
//     arm as usual; for the other arm it ignores motion (that wrist is still) and shows a
//     timer with a Done button, reps defaulting to the watch arm's count. No rest between sides.
//

import Foundation
import Combine
import WatchKit

@MainActor
final class WorkoutSessionViewModel: ObservableObject {

    enum Phase: Equatable {
        case notStarted
        case lifting          // counting the current set
        case setReview        // confirm/adjust reps + weight
        case resting          // rest countdown / alarm
        case finishing
        case finished
    }

    struct LoggedSet: Identifiable {
        let id = UUID()
        let exerciseName: String
        let reps: Int
        let weightKg: Double
    }

    // MARK: Published state

    @Published private(set) var phase: Phase = .notStarted
    @Published private(set) var slots: [WorkoutSlot]
    @Published private(set) var currentIndex = 0
    @Published var currentWeightKg: Double = 0
    @Published private(set) var logged: [LoggedSet] = []
    @Published private(set) var isLogging = false
    /// Count shown when the review screen opens.
    @Published private(set) var reviewReps = 0

    // Collaborators.
    let motion = MotionRepSession()
    let rest = RestAlarmController()
    let workout = WatchWorkoutSession()
    private let voice = VoiceCounter()
    private let settings = AppSettings.shared
    private let sync = SyncService.shared
    private let calibration = CalibrationStore.shared

    let template: Workout
    let sessionClientId = UUID()
    /// The arm wearing the watch, "L" or "R".
    let watchSide: String

    private var liftingSince = Date()
    private var setEndedAt = Date()
    private var lastSetCompletedAt: Date?
    private var recordingTask: Task<SetRecording, Never>?
    private var weightsByExercise: [Int: Double] = [:]
    private var lastLoggedReps = 0

    init(workout: Workout) {
        self.template = workout
        let side = WKInterfaceDevice.current().wristLocation == .right ? "R" : "L"
        self.watchSide = side
        self.slots = WorkoutPlanner.buildSlots(from: workout, watchSide: side)
        motion.onEvent = { [weak self] event in self?.handleMotion(event) }
    }

    // MARK: Derived

    var currentSlot: WorkoutSlot? { slots.indices.contains(currentIndex) ? slots[currentIndex] : nil }
    var nextSlot: WorkoutSlot? { slots.indices.contains(currentIndex + 1) ? slots[currentIndex + 1] : nil }
    /// This set is on the arm without the watch: no motion to count.
    var isOffWrist: Bool { currentSlot?.side.map { $0 != watchSide } ?? false }
    /// When the current set began (for the off-wrist timer).
    var currentSetStartedAt: Date { liftingSince }
    func sideName(_ side: String?) -> String { side == "L" ? "Left" : side == "R" ? "Right" : "" }
    var unit: WeightUnit { settings.units }
    var progressText: String { slots.isEmpty ? "" : "\(min(currentIndex + 1, slots.count))/\(slots.count)" }
    var totalVolumeKg: Double { logged.reduce(0) { $0 + Double($1.reps) * $1.weightKg } }

    func weightText(_ kg: Double) -> String { Units.format(kg: kg, unit: unit) }

    // MARK: Lifecycle

    /// Starts instantly — no network needed.
    func start() {
        guard phase == .notStarted, !slots.isEmpty else { return }
        let startedAt = Date()
        sync.enqueue(.createSession(clientId: sessionClientId, body: CreateSessionBody(
            workoutId: template.id,
            name: template.name,
            source: "watch",
            bodyweightKg: settings.bodyweightKg,
            readinessScore: nil,
            clientId: sessionClientId.uuidString,
            startedAt: Int64(startedAt.timeIntervalSince1970 * 1000)
        )))
        voice.enabled = settings.voiceCount
        motion.start()
        RestAlarmController.requestNotificationPermission()
        Task {
            await workout.requestAuthorization()
            workout.start(name: template.name)
        }
        currentIndex = 0
        beginCurrentSet()
    }

    private func beginCurrentSet() {
        guard let slot = currentSlot else { return }
        currentWeightKg = weightsByExercise[slot.exerciseId] ?? slot.targetWeightKg ?? currentWeightKg
        motion.setParams(calibration.params(for: slot.exerciseId))
        liftingSince = Date()
        if !motion.isSetStarted { voice.reset() }
        phase = .lifting
    }

    // MARK: Motion events

    private func handleMotion(_ event: RepCounterEvent) {
        guard phase != .finishing && phase != .finished && phase != .notStarted else { return }
        // The watch wrist is still while the other arm works: nothing it sees is a rep.
        if phase == .lifting && isOffWrist { return }
        switch event {
        case .setStarted(let n, _):
            voice.enabled = settings.voiceCount
            voice.reset()
            voice.say(n)
            if phase == .resting {
                // Next set detected: silence the alarm and go straight into counting.
                rest.setStarted()
                advanceToNextSlot()
            }
        case .rep(let n, _):
            voice.say(n)
        case .setEnded:
            if phase == .lifting && motion.repCount > 0 { finishCounting() }
        }
    }

    // MARK: Set flow

    /// Done tapped (or the counter saw the set end): review the count.
    func finishCounting() {
        guard phase == .lifting else { return }
        setEndedAt = Date()
        let motion = self.motion
        if isOffWrist {
            // Nothing to count or calibrate; default to what the watch arm just did.
            reviewReps = lastLoggedReps > 0 ? lastLoggedReps : (currentSlot?.targetReps ?? 0)
            Task { _ = await motion.finishSet() }
            recordingTask = nil
        } else {
            reviewReps = motion.repCount
            recordingTask = Task { await motion.finishSet() }
        }
        phase = .setReview
    }

    func stepWeight(_ direction: Int) {
        currentWeightKg = Units.stepped(kg: currentWeightKg, direction: direction,
                                        category: currentSlot?.exercise?.category, unit: unit)
    }

    /// Log the reviewed set. `rpe` is nil unless the user turned it on. 0 reps = skipped.
    func logSet(reps: Int, rpe: Double?, isWarmup: Bool) async {
        guard phase == .setReview, !isLogging, let slot = currentSlot else { return }
        isLogging = true
        defer { isLogging = false }

        let rec = await recordingTask?.value
        recordingTask = nil
        guard phase == .setReview else { return }   // ended meanwhile

        if reps > 0 {
            post(slot: slot, reps: reps, rpe: rpe, isWarmup: isWarmup, recording: rec)
        }
        advance(after: slot)
    }

    private func post(slot: WorkoutSlot, reps: Int, rpe: Double?, isWarmup: Bool, recording rec: SetRecording?) {
        let detected = rec?.detectedReps ?? 0
        let startedAt = rec?.firstRepTime.map { wallDate(uptime: $0 - 1.5) } ?? liftingSince
        let completedAt = rec?.lastRepTime.map { wallDate(uptime: $0 + 0.5) } ?? setEndedAt
        let restActual = lastSetCompletedAt.map { Int(startedAt.timeIntervalSince($0).rounded()) }
        let setClientId = UUID().uuidString

        let body = CreateSetBody(
            exerciseId: slot.exerciseId,
            setIndex: slot.setIndex,
            supersetGroup: slot.supersetGroup,
            reps: reps,
            weightKg: currentWeightKg,
            rpe: rpe,
            isWarmup: isWarmup,
            side: slot.side,
            restSecActual: restActual.map { max(0, $0) },
            startedAt: Int64(startedAt.timeIntervalSince1970 * 1000),
            completedAt: Int64(max(completedAt, startedAt).timeIntervalSince1970 * 1000),
            repEvents: rec?.repEvents(adjustedTo: reps) ?? RepEvent.adjust([], to: reps),
            clientId: setClientId
        )
        sync.enqueue(.addSet(sessionClientId: sessionClientId, body: body))

        logged.append(LoggedSet(exerciseName: slot.exercise?.name ?? "Exercise",
                                reps: reps, weightKg: currentWeightKg))
        weightsByExercise[slot.exerciseId] = currentWeightKg
        lastSetCompletedAt = completedAt
        lastLoggedReps = reps

        guard let rec, !rec.samples.isEmpty else { return }
        let corrected = reps != detected
        if corrected {
            let store = calibration
            let exerciseId = slot.exerciseId
            Task { await store.correct(exerciseId: exerciseId, recording: rec, actual: reps) }
        } else if detected > 0 {
            calibration.confirm(exerciseId: slot.exerciseId)
        }
        if corrected || settings.recordMotion {
            sync.enqueueMotionTrace(MotionTraceBody(
                exerciseId: slot.exerciseId, setClientId: setClientId, sampleHz: 50,
                detectedReps: detected, actualReps: reps, params: rec.params, motion: rec.samples))
        }
    }

    /// Rest after the last member of a superset round; otherwise straight to the next set.
    private func advance(after slot: WorkoutSlot) {
        guard currentIndex < slots.count - 1 else {
            Task { await finish() }
            return
        }
        if let next = nextSlot { motion.setParams(calibration.params(for: next.exerciseId)) }
        if slot.restAfter && !motion.isSetStarted {
            phase = .resting
            rest.start(restSec: slot.restSec, snoozeSec: settings.restAlarmSnoozeSec)
        } else {
            // Superset partner, or the next set already started while reviewing.
            advanceToNextSlot()
        }
    }

    private func advanceToNextSlot() {
        guard currentIndex < slots.count - 1 else {
            Task { await finish() }
            return
        }
        currentIndex += 1
        beginCurrentSet()
    }

    /// "Go" during rest / alarm.
    func startNextSetNow() {
        rest.skip()
        advanceToNextSlot()
    }

    /// Skip the current slot without logging.
    func skipSlot() {
        if phase == .lifting {
            let motion = self.motion
            Task { _ = await motion.finishSet() }
        }
        recordingTask = nil
        rest.skip()
        advanceToNextSlot()
    }

    // MARK: Finish

    /// End Workout (any time) or the last set logged. Unlogged in-progress sets are dropped.
    func finish() async {
        guard phase != .finishing && phase != .finished else { return }
        phase = .finishing
        rest.skip()
        motion.stop()
        recordingTask = nil
        // Save the Apple workout first so its calories + heart rate go to the server with the
        // finish (the dashboard then shows the same number as Fitness).
        let hk = await workout.end()
        var body = FinishSessionBody(notes: nil,
                                     bodyweightKg: await workout.latestBodyMassKg() ?? settings.bodyweightKg)
        if let kcal = hk?.energyKcal, kcal > 0 {
            body.activeKcal = kcal
            body.avgHr = hk?.avgHr
            body.kcalSource = .appleWatch
        }
        sync.enqueue(.finishSession(sessionClientId: sessionClientId, body: body))
        phase = .finished
    }
}
