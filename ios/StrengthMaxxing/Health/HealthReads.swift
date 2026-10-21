//
//  HealthReads.swift
//  StrengthMaxxing (shared)
//
//  Small HealthKit reads used by both the phone and the watch.
//

import Foundation
import HealthKit

enum HealthReads {
    /// Most recent value of a quantity type (e.g. body weight), or nil if none / not allowed.
    static func latestQuantity(_ id: HKQuantityTypeIdentifier, unit: HKUnit, store: HKHealthStore) async -> Double? {
        guard HKHealthStore.isHealthDataAvailable(),
              let type = HKQuantityType.quantityType(forIdentifier: id) else { return nil }
        let descriptor = HKSampleQueryDescriptor(
            predicates: [.quantitySample(type: type)],
            sortDescriptors: [SortDescriptor(\.endDate, order: .reverse)],
            limit: 1
        )
        return (try? await descriptor.result(for: store))?.first?.quantity.doubleValue(for: unit)
    }
}
