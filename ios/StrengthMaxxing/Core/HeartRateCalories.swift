//
//  HeartRateCalories.swift
//  StrengthMaxxing (shared, PURE)
//
//  Active calories from heart rate, for workouts logged on the PHONE (the watch's own live
//  workout uses Apple's calorie number instead — that one is better, use it when present).
//
//  Gross burn per minute: Keytel et al. 2005, "Prediction of energy expenditure from heart
//  rate monitoring during submaximal exercise" (J Sports Sci 23:289). Active = gross minus
//  resting burn (Mifflin–St Jeor BMR), so it matches Apple's "Active Calories". Unknown sex
//  averages the two equations; unknown height uses a typical adult height.
//

import Foundation

enum BiologicalSex: String, Codable, Sendable { case male, female, unknown }

struct BodyProfile: Equatable, Sendable {
    var weightKg: Double
    var ageYears: Double
    var sex: BiologicalSex = .unknown
    var heightCm: Double? = nil
}

struct HeartRateSample: Equatable, Sendable {
    var t: Double      // seconds (any epoch, same as start/end)
    var bpm: Double
}

enum HeartRateCalories {
    /// A sample stands for at most this long; longer gaps count as "no data".
    static let maxSampleSpanSec = 120.0
    /// Below this share of the workout covered by heart rate, return nil (use the estimate).
    static let minCoverage = 0.6
    /// Keytel is only validated during exercise and over-counts near resting heart rate, so
    /// active burn ramps linearly from 0 at `restBpm` to the full equation at `exerciseBpm`.
    static let restBpm = 70.0
    static let exerciseBpm = 90.0

    /// Active kcal and time-weighted average heart rate over [start, end], or nil when the
    /// heart-rate data is too sparse to trust.
    static func activeKcal(
        samples: [HeartRateSample], start: Double, end: Double, profile: BodyProfile
    ) -> (kcal: Double, avgHr: Double)? {
        let duration = end - start
        guard duration > 0, profile.weightKg > 0 else { return nil }
        let pts = samples
            .filter { $0.t >= start && $0.t <= end && $0.bpm >= 30 && $0.bpm <= 250 }
            .sorted { $0.t < $1.t }
        guard !pts.isEmpty else { return nil }

        let basalPerMin = bmr(profile) / 1440
        var covered = 0.0, kcal = 0.0, hrSeconds = 0.0
        for (i, p) in pts.enumerated() {
            let next = i + 1 < pts.count ? pts[i + 1].t : end
            let span = min(next - p.t, maxSampleSpanSec)
            guard span > 0 else { continue }
            covered += span
            hrSeconds += p.bpm * span
            kcal += activePerMin(bpm: p.bpm, profile, basalPerMin: basalPerMin) * span / 60
        }
        guard covered / duration >= minCoverage else { return nil }
        return (kcal, hrSeconds / covered)
    }

    static func activePerMin(bpm: Double, _ p: BodyProfile, basalPerMin: Double) -> Double {
        let weight = min(1, max(0, (bpm - restBpm) / (exerciseBpm - restBpm)))
        return weight * max(0, grossPerMin(bpm: bpm, p) - basalPerMin)
    }

    /// Keytel 2005 gross energy expenditure, kcal/min.
    static func grossPerMin(bpm: Double, _ p: BodyProfile) -> Double {
        let male = (-55.0969 + 0.6309 * bpm + 0.1988 * p.weightKg + 0.2017 * p.ageYears) / 4.184
        let female = (-20.4022 + 0.4472 * bpm - 0.1263 * p.weightKg + 0.074 * p.ageYears) / 4.184
        switch p.sex {
        case .male: return male
        case .female: return female
        case .unknown: return (male + female) / 2
        }
    }

    /// Mifflin–St Jeor resting burn, kcal/day.
    static func bmr(_ p: BodyProfile) -> Double {
        let height = p.heightCm ?? (p.sex == .female ? 163 : p.sex == .male ? 177 : 170)
        let base = 10 * p.weightKg + 6.25 * height - 5 * p.ageYears
        switch p.sex {
        case .male: return base + 5
        case .female: return base - 161
        case .unknown: return base - 78
        }
    }
}
