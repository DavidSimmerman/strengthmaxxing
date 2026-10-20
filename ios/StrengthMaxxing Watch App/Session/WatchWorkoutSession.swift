//
//  WatchWorkoutSession.swift
//  StrengthMaxxing Watch App
//
//  Runs a live HKWorkoutSession on the watch for the duration of the training session so
//  Apple captures heart rate + active energy (Activity rings) and the workout is mirrored
//  to HealthKit. Uses HKLiveWorkoutBuilder with .traditionalStrengthTraining.
//
//  Lifecycle: start() at session begin → live HR/energy published → end() on finish,
//  which finalizes and saves the HKWorkout to the Health store.
//

import Foundation
import HealthKit
import Combine

@MainActor
final class WatchWorkoutSession: NSObject, ObservableObject {
    @Published private(set) var heartRate: Double = 0
    @Published private(set) var activeEnergyKcal: Double = 0
    @Published private(set) var isActive = false

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?

    private(set) var startDate: Date?

    /// Request authorization for the types the live session needs.
    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else { return }
        var share: Set<HKSampleType> = [HKObjectType.workoutType()]
        var read: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let energy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            share.insert(energy); read.insert(energy)
        }
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { read.insert(hr) }
        try? await store.requestAuthorization(toShare: share, read: read)
    }

    /// Begin the live workout session.
    func start() {
        guard HKHealthStore.isHealthDataAvailable(), session == nil else { return }
        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        do {
            let s = try HKWorkoutSession(healthStore: store, configuration: config)
            let b = s.associatedWorkoutBuilder()
            b.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: config)
            s.delegate = self
            b.delegate = self

            let start = Date()
            self.startDate = start
            self.session = s
            self.builder = b
            s.startActivity(with: start)
            Task {
                do {
                    try await b.beginCollection(at: start)
                    self.isActive = true
                } catch {
                    print("HK beginCollection failed: \(error)")
                }
            }
        } catch {
            // If the session can't start (e.g. simulator without Health), we degrade
            // gracefully — reps + rest + offline sync all still work without the ring.
            self.session = nil
            self.builder = nil
        }
    }

    /// Optional: pause/resume around long rests to keep energy honest.
    func pause() { session?.pause() }
    func resume() { session?.resume() }

    /// End the live session and save the HKWorkout. Returns its dates + energy.
    func end() async -> (start: Date, end: Date, energyKcal: Double)? {
        guard let session, let builder else { return nil }
        let endDate = Date()
        session.end()
        do {
            try await builder.endCollection(at: endDate)
            _ = try await builder.finishWorkout()
        } catch {
            print("HK finish failed: \(error)")
        }
        let result = (start: startDate ?? endDate, end: endDate, energyKcal: activeEnergyKcal)
        isActive = false
        self.session = nil
        self.builder = nil
        return result
    }

    func discard() {
        session?.end()
        session = nil
        builder = nil
        isActive = false
    }
}

// MARK: - HKWorkoutSessionDelegate

extension WatchWorkoutSession: HKWorkoutSessionDelegate {
    nonisolated func workoutSession(
        _ workoutSession: HKWorkoutSession,
        didChangeTo toState: HKWorkoutSessionState,
        from fromState: HKWorkoutSessionState,
        date: Date
    ) {
        Task { @MainActor in
            self.isActive = (toState == .running)
        }
    }

    nonisolated func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        Task { @MainActor in self.isActive = false }
    }
}

// MARK: - HKLiveWorkoutBuilderDelegate

extension WatchWorkoutSession: HKLiveWorkoutBuilderDelegate {
    nonisolated func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    nonisolated func workoutBuilder(
        _ workoutBuilder: HKLiveWorkoutBuilder,
        didCollectDataOf collectedTypes: Set<HKSampleType>
    ) {
        for type in collectedTypes {
            guard let quantityType = type as? HKQuantityType,
                  let stats = workoutBuilder.statistics(for: quantityType) else { continue }

            if quantityType == HKQuantityType.quantityType(forIdentifier: .heartRate) {
                let unit = HKUnit.count().unitDivided(by: .minute())
                let bpm = stats.mostRecentQuantity()?.doubleValue(for: unit) ?? 0
                Task { @MainActor in self.heartRate = bpm }
            } else if quantityType == HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
                let kcal = stats.sumQuantity()?.doubleValue(for: .kilocalorie()) ?? 0
                Task { @MainActor in self.activeEnergyKcal = kcal }
            }
        }
    }
}
