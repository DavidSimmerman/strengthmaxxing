//
//  RepCounter.swift
//  StrengthMaxxing Watch App
//
//  Automatic rep counting from CoreMotion device-motion.
//
//  Approach — adaptive peak detection on the magnitude of userAcceleration:
//   1. We sample `deviceMotion` at ~50 Hz. For each sample we take the magnitude of
//      the userAcceleration vector (gravity already removed by CoreMotion), giving an
//      orientation-independent "effort" signal that works regardless of how the wrist
//      is turned for a given lift.
//   2. That magnitude is smoothed with a small exponential moving average to kill jitter.
//   3. A rep is the CONCENTRIC burst: the smoothed signal rising above an adaptive
//      threshold (a running baseline + k·runningDeviation). We detect the local peak of
//      each burst and count one rep per peak.
//   4. A refractory period (min time between reps) prevents a single explosive rep or
//      sensor ringing from double-counting. This also sets a sane ceiling on cadence.
//   5. Concentric duration is estimated as the time from threshold-crossing (start of the
//      burst) to the peak. offsetMs is measured from the FIRST rep of the set.
//
//  This is intentionally a self-contained, testable class: feed it (timestamp, accel)
//  samples and it emits reps via a callback. `MotionRepSession` wires it to CMMotionManager.
//

import Foundation
// When this file is compiled inside the standalone SwiftPM test target (see Package.swift),
// `RepEvent` lives in a separate module and must be imported. In the Xcode app all sources
// share one module, so the flag is undefined there and this import is skipped.
#if SM_SPM_TESTS
@testable import StrengthMaxxing
#endif

/// A detected repetition.
struct DetectedRep: Hashable {
    /// 0-based index within the current set.
    let repIndex: Int
    /// Milliseconds from the first rep of the set (rep 0 is always 0).
    let offsetMs: Int
    /// Estimated concentric (lift) duration in ms, if measurable.
    let concentricMs: Int?
    /// Absolute time of the detected peak (device uptime seconds).
    let peakTime: TimeInterval
}

/// Tunable parameters for the detector. Defaults are reasonable for strength work.
struct RepCounterConfig {
    /// EMA smoothing factor for the signal (0..1, higher = snappier, noisier).
    var smoothing: Double = 0.35
    /// EMA factor for the slow adaptive baseline/deviation.
    var baselineAdapt: Double = 0.02
    /// Threshold = baseline + thresholdK * deviation. Higher ⇒ needs a stronger burst.
    var thresholdK: Double = 2.2
    /// A burst must exceed this absolute floor (g) to count — rejects idle noise.
    var minPeakG: Double = 0.12
    /// Minimum seconds between two counted reps (refractory period).
    var refractory: TimeInterval = 0.55
    /// A burst is "closed" once the signal falls back below (baseline + release·deviation).
    var releaseK: Double = 0.8

    static let `default` = RepCounterConfig()
}

/// Pure, deterministic rep detector. No CoreMotion import here so it can be unit-tested
/// by feeding synthetic samples.
final class RepCounter {
    private(set) var reps: [DetectedRep] = []
    var onRep: ((DetectedRep) -> Void)?

    private let config: RepCounterConfig

    // Running signal state.
    private var smoothed: Double = 0
    private var baseline: Double = 0
    private var deviation: Double = 0.05
    private var initialized = false

    // Burst tracking.
    private var inBurst = false
    private var burstStartTime: TimeInterval = 0
    private var burstPeakValue: Double = 0
    private var burstPeakTime: TimeInterval = 0

    private var lastRepTime: TimeInterval = -.greatestFiniteMagnitude
    private var firstRepTime: TimeInterval?

    init(config: RepCounterConfig = .default) {
        self.config = config
    }

    /// Resets all state for a new set.
    func reset() {
        reps.removeAll(keepingCapacity: true)
        smoothed = 0
        baseline = 0
        deviation = 0.05
        initialized = false
        inBurst = false
        burstPeakValue = 0
        lastRepTime = -.greatestFiniteMagnitude
        firstRepTime = nil
    }

    /// Feed one accelerometer magnitude sample.
    /// - Parameters:
    ///   - magnitude: |userAcceleration| in g.
    ///   - time: monotonic timestamp in seconds (e.g. deviceMotion.timestamp).
    func addSample(magnitude: Double, at time: TimeInterval) {
        // Smooth.
        if !initialized {
            smoothed = magnitude
            baseline = magnitude
            initialized = true
            return
        }
        smoothed += config.smoothing * (magnitude - smoothed)

        let threshold = baseline + config.thresholdK * deviation
        let release = baseline + config.releaseK * deviation

        if !inBurst {
            // Adapt baseline & deviation only while at rest (outside a burst) so the
            // threshold tracks the noise floor, not the reps themselves.
            baseline += config.baselineAdapt * (smoothed - baseline)
            let inst = abs(smoothed - baseline)
            deviation += config.baselineAdapt * (inst - deviation)
            deviation = max(deviation, 0.01)

            if smoothed > threshold && smoothed > config.minPeakG {
                // Start of a concentric burst.
                inBurst = true
                burstStartTime = time
                burstPeakValue = smoothed
                burstPeakTime = time
            }
        } else {
            // Track the peak of the ongoing burst.
            if smoothed > burstPeakValue {
                burstPeakValue = smoothed
                burstPeakTime = time
            }
            // Burst closes when the signal relaxes back down.
            if smoothed < release {
                inBurst = false
                registerRepIfValid()
            }
        }
    }

    private func registerRepIfValid() {
        // Refractory guard.
        guard burstPeakTime - lastRepTime >= config.refractory else { return }
        guard burstPeakValue >= config.minPeakG else { return }

        lastRepTime = burstPeakTime
        if firstRepTime == nil { firstRepTime = burstPeakTime }
        let offsetMs = Int(((burstPeakTime) - (firstRepTime ?? burstPeakTime)) * 1000.0)
        let concentricMs = Int(max(0, (burstPeakTime - burstStartTime)) * 1000.0)

        let rep = DetectedRep(
            repIndex: reps.count,
            offsetMs: max(0, offsetMs),
            concentricMs: concentricMs > 0 ? concentricMs : nil,
            peakTime: burstPeakTime
        )
        reps.append(rep)
        onRep?(rep)
    }

    /// Allow a manual correction (e.g. user taps -1 or +1 on the watch).
    func adjustCount(to newCount: Int) {
        if newCount < reps.count {
            reps = Array(reps.prefix(max(0, newCount)))
        } else {
            // Pad with synthetic reps spaced by the refractory period so offsets stay sane.
            let base = reps.last?.peakTime ?? (firstRepTime ?? 0)
            while reps.count < newCount {
                let t = base + config.refractory * Double(reps.count + 1)
                if firstRepTime == nil { firstRepTime = t }
                let offsetMs = Int((t - (firstRepTime ?? t)) * 1000.0)
                reps.append(DetectedRep(repIndex: reps.count, offsetMs: max(0, offsetMs),
                                        concentricMs: nil, peakTime: t))
            }
        }
    }

    /// Convert to the API's rep-event payload.
    func repEvents() -> [RepEvent] {
        reps.map { RepEvent(repIndex: $0.repIndex, offsetMs: $0.offsetMs, concentricMs: $0.concentricMs) }
    }

    var count: Int { reps.count }
}
