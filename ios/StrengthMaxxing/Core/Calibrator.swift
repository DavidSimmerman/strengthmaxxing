//
//  Calibrator.swift
//  StrengthMaxxing (shared, PURE)
//
//  Per-exercise learning for the rep counter.
//
//  When the user corrects a set's count to N, `Calibrator.refit` replays that set's raw
//  samples through `RepCounter` over a small grid (threshold × minInterval × rotationWeight
//  × noiseFloor) and picks the params that reproduce N, preferring the ones closest to the
//  current params. `CalibrationBook` then blends that fit into the stored params with an
//  EMA whose weight shrinks as the exercise accumulates samples (corrections and
//  confirmations), with a floor so it keeps adapting. One weird set moves the params at
//  most 25% once the exercise has history.
//

import Foundation

enum Calibrator {
    static let thresholdGrid: [Double] = stride(from: 0.2, through: 0.7001, by: 0.05).map { ($0 * 100).rounded() / 100 }
    static let minIntervalGrid: [Double] = [0.5, 0.7, 0.9, 1.1, 1.4, 1.8, 2.2]
    static let weightGrid: [Double] = [0, 0.25, 0.5, 0.75, 1]

    struct Fit: Equatable, Sendable {
        let params: RepCounterParams
        /// What the fitted params count on the recorded set.
        let count: Int
        var isExact: Bool
    }

    /// Normalized distance between parameter sets (used to prefer minimal changes).
    static func distance(_ a: RepCounterParams, _ b: RepCounterParams) -> Double {
        abs(a.threshold - b.threshold) / 0.5
            + abs(a.minInterval - b.minInterval) / 1.7
            + abs(a.rotationWeight - b.rotationWeight)
            + abs(a.noiseFloor - b.noiseFloor) / 0.25
    }

    /// Finds params that make the recorded set count `targetCount`. Nil if nothing to fit.
    /// CPU: ~770 replays of the set — run it off the main thread.
    static func refit(samples: [MotionSample], targetCount: Int, current: RepCounterParams,
                      sampleRate: Double = 50) -> Fit? {
        guard targetCount > 0, samples.count > Int(sampleRate * 2) else { return nil }
        var best: (miss: Int, dist: Double, params: RepCounterParams, count: Int)?
        for nf in [current.noiseFloor, current.noiseFloor * 0.6] {
            for w in weightGrid {
                for mi in minIntervalGrid {
                    for th in thresholdGrid {
                        let p = RepCounterParams(threshold: th, minInterval: mi, rotationWeight: w, noiseFloor: nf)
                        let n = RepCounter.replay(samples, params: p, sampleRate: sampleRate)
                        let miss = abs(n - targetCount)
                        let dist = distance(p, current)
                        if let b = best, !(miss < b.miss || (miss == b.miss && dist < b.dist)) { continue }
                        best = (miss, dist, p, n)
                    }
                }
            }
        }
        guard let b = best else { return nil }
        return Fit(params: b.params, count: b.count, isExact: b.miss == 0)
    }

    /// EMA weight for a new correction given how many samples the exercise already has.
    static func blendWeight(samples: Int) -> Double {
        max(0.25, 1.0 / Double(max(samples, 0) + 1))
    }

    static func blend(_ stored: RepCounterParams, toward fitted: RepCounterParams, samples: Int) -> RepCounterParams {
        let a = blendWeight(samples: samples)
        if a >= 1 { return fitted.clamped() }
        func lerp(_ x: Double, _ y: Double) -> Double { x + (y - x) * a }
        return RepCounterParams(
            threshold: lerp(stored.threshold, fitted.threshold),
            minInterval: lerp(stored.minInterval, fitted.minInterval),
            rotationWeight: lerp(stored.rotationWeight, fitted.rotationWeight),
            noiseFloor: lerp(stored.noiseFloor, fitted.noiseFloor)
        ).clamped()
    }
}

// MARK: - Per-exercise store (pure value type; persisted by the app)

struct CalibrationEntry: Codable, Equatable, Sendable {
    var params: RepCounterParams
    /// Corrections + confirmations seen for this exercise.
    var samples: Int
    /// Epoch seconds of the last local change.
    var updatedAt: Double
}

/// `GET /api/calibration` element.
struct RemoteCalibration: Decodable, Sendable {
    let exerciseId: Int
    let params: RepCounterParams
    let samples: Int
}

/// `PUT /api/calibration/:exerciseId` body.
struct CalibrationPutBody: Codable, Equatable, Sendable {
    let params: RepCounterParams
    let samples: Int
}

struct CalibrationBook: Codable, Equatable, Sendable {
    /// Keyed by exerciseId as a string (JSON object keys).
    var entries: [String: CalibrationEntry] = [:]

    func entry(for exerciseId: Int) -> CalibrationEntry? { entries[String(exerciseId)] }

    func params(for exerciseId: Int) -> RepCounterParams {
        entry(for: exerciseId)?.params ?? .default
    }

    /// User corrected the count; `fitted` came from `Calibrator.refit`.
    @discardableResult
    mutating func applyCorrection(exerciseId: Int, fitted: RepCounterParams, now: Double) -> CalibrationEntry {
        let old = entry(for: exerciseId) ?? CalibrationEntry(params: .default, samples: 0, updatedAt: now)
        let e = CalibrationEntry(
            params: Calibrator.blend(old.params, toward: fitted, samples: old.samples),
            samples: old.samples + 1,
            updatedAt: now
        )
        entries[String(exerciseId)] = e
        return e
    }

    /// User accepted the detected count — reinforces the current params.
    @discardableResult
    mutating func confirm(exerciseId: Int, now: Double) -> CalibrationEntry {
        var e = entry(for: exerciseId) ?? CalibrationEntry(params: .default, samples: 0, updatedAt: now)
        e.samples += 1
        e.updatedAt = now
        entries[String(exerciseId)] = e
        return e
    }

    /// Adopt server rows that have seen more samples than ours (e.g. after a reinstall or
    /// from another watch). Local wins ties, so unsynced local learning isn't clobbered.
    mutating func merge(remote: [RemoteCalibration], now: Double) {
        for r in remote {
            let key = String(r.exerciseId)
            if let local = entries[key], local.samples >= r.samples { continue }
            entries[key] = CalibrationEntry(params: r.params.clamped(), samples: r.samples, updatedAt: now)
        }
    }
}
