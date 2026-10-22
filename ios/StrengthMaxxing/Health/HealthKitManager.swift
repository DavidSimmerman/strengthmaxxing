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
        for id: HKQuantityTypeIdentifier in [.heartRate, .activeEnergyBurned, .bodyMass, .height] {
            if let t = HKObjectType.quantityType(forIdentifier: id) { set.insert(t) }
        }
        for id: HKCharacteristicTypeIdentifier in [.dateOfBirth, .biologicalSex] {
            if let t = HKObjectType.characteristicType(forIdentifier: id) { set.insert(t) }
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

    // MARK: - Reading the body profile + heart rate (for calories)

    /// Weight, age, sex and height from Health; nil without a weight. Each read fails soft
    /// (denied / never entered) to the unknown default.
    func bodyProfile(fallbackWeightKg: Double?) async -> BodyProfile? {
        guard let weight = await HealthReads.latestQuantity(.bodyMass, unit: .gramUnit(with: .kilo), store: store)
                ?? fallbackWeightKg else { return nil }
        var age = 35.0
        if let dob = try? store.dateOfBirthComponents(), let year = dob.year {
            age = Double(Calendar.current.component(.year, from: Date()) - year)
        }
        var sex = BiologicalSex.unknown
        switch (try? store.biologicalSex())?.biologicalSex {
        case .some(.male): sex = .male
        case .some(.female): sex = .female
        default: break
        }
        let height = await HealthReads.latestQuantity(.height, unit: .meterUnit(with: .centi), store: store)
        return BodyProfile(weightKg: weight, ageYears: age, sex: sex, heightCm: height)
    }

    /// Active calories + average heart rate from the heart rate Health recorded (e.g. by the
    /// watch on your wrist) between start and end. Nil when there isn't enough heart rate.
    func heartRateCalories(start: Date, end: Date, fallbackWeightKg: Double?) async -> (kcal: Double, avgHr: Double)? {
        guard isHealthDataAvailable,
              let profile = await bodyProfile(fallbackWeightKg: fallbackWeightKg),
              let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return nil }
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.quantitySample(type: type, predicate: HKQuery.predicateForSamples(withStart: start, end: end))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        )
        guard let samples = try? await descriptor.result(for: store) else { return nil }
        let bpm = HKUnit.count().unitDivided(by: .minute())
        let points = samples.map {
            HeartRateSample(t: $0.startDate.timeIntervalSince1970, bpm: $0.quantity.doubleValue(for: bpm))
        }
        return HeartRateCalories.activeKcal(
            samples: points, start: start.timeIntervalSince1970, end: end.timeIntervalSince1970, profile: profile)
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
        try await saveStrengthWorkout(start: start, end: end, energyKcal: energyKcal,
                                      sessionId: session.id, name: session.name,
                                      volumeKg: session.totalVolumeKg)
    }

    /// Same, from plain values (the web app inside the iPhone shell calls this).
    func saveStrengthWorkout(
        start: Date,
        end: Date,
        energyKcal: Double?,
        sessionId: Int?,
        name: String?,
        volumeKg: Double?
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
        var metadata: [String: Any] = [HKMetadataKeyWorkoutBrandName: "StrengthMaxxing"]
        if let sessionId { metadata["sessionId"] = sessionId }
        if let name { metadata["workoutName"] = name }
        if let volumeKg { metadata["totalVolumeKg"] = volumeKg }
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
        let start = ISO8601.parse(session.startedAt) ?? fallbackStart
        let end = ISO8601.parse(session.endedAt) ?? fallbackEnd
        try await saveStrengthWorkout(
            start: start, end: end, energyKcal: session.estimatedKcal, session: session
        )
    }
}
