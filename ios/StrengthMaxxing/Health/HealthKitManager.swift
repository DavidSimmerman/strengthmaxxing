//
//  HealthKitManager.swift
//  StrengthMaxxing (shared)
//
//  Authorization + writing a traditional-strength-training HKWorkout using the modern
//  HKWorkoutBuilder API. Used on iOS (write on finish) and referenced on watchOS
//  (the live session's HKLiveWorkoutBuilder finalizes the workout there — see
//  WatchWorkoutSession). This type provides the shared authorization + a phone-side
//  builder path when the finish happens on the phone.
//

import Foundation
import HealthKit
import Combine

@MainActor
final class HealthKitManager: ObservableObject {
    static let shared = HealthKitManager()

    let store = HKHealthStore()

    @Published var isAuthorized = false

    /// Types we want to write. Read heart rate/energy so the watch session can surface it.
    private var typesToShare: Set<HKSampleType> {
        var set: Set<HKSampleType> = [HKObjectType.workoutType()]
        if let energy = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            set.insert(energy)
        }
        return set
    }

    private var typesToRead: Set<HKObjectType> {
        var set: Set<HKObjectType> = [HKObjectType.workoutType()]
        if let hr = HKObjectType.quantityType(forIdentifier: .heartRate) { set.insert(hr) }
        if let energy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned) {
            set.insert(energy)
        }
        return set
    }

    var isHealthDataAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    /// Requests authorization. Safe to call repeatedly; the system only prompts once.
    func requestAuthorization() async {
        guard isHealthDataAvailable else { return }
        do {
            try await store.requestAuthorization(toShare: typesToShare, read: typesToRead)
            // We can't reliably read share-authorization status, so treat a successful
            // (non-throwing) request as "prompted"; writes will simply no-op if denied.
            isAuthorized = true
        } catch {
            isAuthorized = false
        }
    }

    // MARK: - Writing a workout (phone-side finish path)

    /// Builds and saves a `.traditionalStrengthTraining` HKWorkout for a finished session.
    ///
    /// - Parameters:
    ///   - start/end: the wall-clock bounds of the session.
    ///   - energyKcal: totalEnergyBurned (kcal) — from the finish response's `estimatedKcal`.
    ///   - session: used to attach descriptive metadata.
    func saveStrengthWorkout(
        start: Date,
        end: Date,
        energyKcal: Double?,
        session: Session
    ) async throws {
        guard isHealthDataAvailable else { return }

        let config = HKWorkoutConfiguration()
        config.activityType = .traditionalStrengthTraining
        config.locationType = .indoor

        let builder = HKWorkoutBuilder(healthStore: store, configuration: config, device: .local())

        try await builder.beginCollection(at: start)

        // Attach an active-energy sample so Activity rings / Fitness reflect the burn.
        var samples: [HKSample] = []
        if let kcal = energyKcal, kcal > 0,
           let energyType = HKQuantityType.quantityType(forIdentifier: .activeEnergyBurned) {
            let quantity = HKQuantity(unit: .kilocalorie(), doubleValue: kcal)
            let energySample = HKCumulativeQuantitySample(
                type: energyType, quantity: quantity, start: start, end: end
            )
            samples.append(energySample)
        }
        if !samples.isEmpty {
            try await builder.addSamples(samples)
        }

        // Metadata.
        var metadata: [String: Any] = [
            HKMetadataKeyWorkoutBrandName: "StrengthMaxxing",
            "sessionId": session.id,
        ]
        if let name = session.name { metadata["templateName"] = name }
        if let volume = session.totalVolumeKg { metadata["totalVolumeKg"] = volume }
        metadata[HKMetadataKeyIndoorWorkout] = true
        try await builder.addMetadata(metadata)

        try await builder.endCollection(at: end)
        _ = try await builder.finishWorkout()
    }

    /// Convenience: derive start/end from the session's ISO timestamps if present,
    /// otherwise fall back to the supplied bounds.
    func saveStrengthWorkout(
        for session: Session,
        fallbackStart: Date,
        fallbackEnd: Date
    ) async throws {
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let isoNoFrac = ISO8601DateFormatter()

        func parse(_ s: String?) -> Date? {
            guard let s else { return nil }
            return iso.date(from: s) ?? isoNoFrac.date(from: s)
        }

        let start = parse(session.startedAt) ?? fallbackStart
        let end = parse(session.endedAt) ?? fallbackEnd
        try await saveStrengthWorkout(
            start: start, end: end, energyKcal: session.estimatedKcal, session: session
        )
    }
}
