//
//  RepCounter.swift
//  StrengthMaxxing (shared, PURE — compiled by Package.swift and the unit-test target)
//
//  Automatic rep counting from wrist motion. Foundation-only so it can be unit-tested with
//  synthetic signals; `MotionRepSession` (watch) feeds it CoreMotion device-motion at 50 Hz.
//
//  Signal pipeline (per sample):
//   1. Vertical: userAcceleration projected on the gravity unit vector (signed, + = down),
//      leaky-integrated to a VELOCITY, then band-passed (0.1–2.5 Hz biquads).
//      Velocity, not acceleration: a rep's acceleration has two bursts per movement
//      (speed up, slow down), which double-counted slow reps. Velocity is one lobe per
//      movement direction: one lobe up, one lobe down.
//   2. Rotation: rotationRate band-passed per axis, projected on the dominant rotation axis
//      (power iteration on a running covariance). Signed angular velocity is also one
//      lobe per direction, which suits curls/raises (mostly rotation, little vertical travel).
//   3. Rotation's arbitrary sign is aligned with vertical via their running correlation,
//      then the two are mixed by `rotationWeight` (0 = vertical only, 0.5 = both at full
//      strength, 1 = rotation only).
//
//  Detection:
//   - "Lobes" = excursions of the combined signal away from zero (Schmitt trigger with
//     hysteresis). A lobe counts if its peak ≥ max(noiseFloor, threshold × running rep
//     amplitude) and it lasts ≥ 0.4 s. Adjacent same-sign lobes merge, so a sticking point
//     mid-rep doesn't add a rep.
//   - A rep = one lobe of the set's first polarity followed by one of the opposite polarity
//     (one full up+down), with ≥ minInterval between reps.
//   - Set start: the counter runs continuously (during rest too). It declares the set
//     started only after 2 consecutive rep-like cycles with consistent amplitude/duration,
//     then counts those 2 reps retroactively. Walking/unracking doesn't form such a pair.
//   - Set end: 10 s without a valid lobe after start → `.setEnded`.
//
//  Learning: `RepCounterParams` are per exercise. `Calibrator` replays a set's recorded raw
//  samples to refit the params when the user corrects the count.
//

import Foundation

// MARK: - Inputs / outputs

/// One device-motion sample. `t` in seconds (monotonic), accel in g, gravity unit vector,
/// rotation rate in rad/s — exactly CoreMotion's CMDeviceMotion fields.
struct MotionSample: Equatable, Sendable {
    var t: Double
    var ax: Double, ay: Double, az: Double
    var gx: Double, gy: Double, gz: Double
    var rx: Double, ry: Double, rz: Double

    init(t: Double,
         ax: Double = 0, ay: Double = 0, az: Double = 0,
         gx: Double = 0, gy: Double = 0, gz: Double = 1,
         rx: Double = 0, ry: Double = 0, rz: Double = 0) {
        self.t = t
        self.ax = ax; self.ay = ay; self.az = az
        self.gx = gx; self.gy = gy; self.gz = gz
        self.rx = rx; self.ry = ry; self.rz = rz
    }
}

/// Per-exercise tunables. Stored locally and on the server (opaque JSON) — learned by
/// `Calibrator` from the user's corrections.
struct RepCounterParams: Codable, Equatable, Sendable {
    /// A lobe must reach this fraction of the running rep amplitude to count.
    var threshold: Double
    /// Minimum seconds between two counted reps.
    var minInterval: Double
    /// 0 = vertical velocity only, 0.5 = both at full strength, 1 = rotation only.
    var rotationWeight: Double
    /// Absolute minimum lobe peak (normalized units) — rejects idle noise.
    var noiseFloor: Double

    static let `default` = RepCounterParams()

    init(threshold: Double = 0.4, minInterval: Double = 1.0,
         rotationWeight: Double = 0.5, noiseFloor: Double = 0.25) {
        self.threshold = threshold
        self.minInterval = minInterval
        self.rotationWeight = rotationWeight
        self.noiseFloor = noiseFloor
    }

    enum CodingKeys: String, CodingKey {
        case threshold, minInterval, rotationWeight, noiseFloor
    }

    /// Tolerates missing keys (server blob from an older version) by using defaults.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = RepCounterParams()
        self.init(
            threshold: try c.decodeIfPresent(Double.self, forKey: .threshold) ?? d.threshold,
            minInterval: try c.decodeIfPresent(Double.self, forKey: .minInterval) ?? d.minInterval,
            rotationWeight: try c.decodeIfPresent(Double.self, forKey: .rotationWeight) ?? d.rotationWeight,
            noiseFloor: try c.decodeIfPresent(Double.self, forKey: .noiseFloor) ?? d.noiseFloor
        )
        self = self.clamped()
    }

    /// Keeps values in a sane range so a corrupt blob can't disable counting.
    func clamped() -> RepCounterParams {
        RepCounterParams(
            threshold: min(max(threshold, 0.1), 0.9),
            minInterval: min(max(minInterval, 0.3), 4.0),
            rotationWeight: min(max(rotationWeight, 0), 1),
            noiseFloor: min(max(noiseFloor, 0.05), 1.0)
        )
    }
}

enum RepCounterEvent: Equatable, Sendable {
    /// Two consistent reps seen: the set has started; `count` includes them (2).
    case setStarted(count: Int, time: Double)
    case rep(count: Int, time: Double)
    /// No movement for a while after the set started.
    case setEnded(count: Int, time: Double)

    var count: Int {
        switch self {
        case .setStarted(let c, _), .rep(let c, _), .setEnded(let c, _): return c
        }
    }
}

struct CountedRep: Equatable, Sendable {
    /// Sample time of the rep's completing lobe peak (seconds, same clock as samples).
    let time: Double
    /// Duration of the "moving up" lobe, when identifiable.
    let concentricSec: Double?
}

/// Everything about one set the app needs to post it, calibrate, and upload a trace.
struct SetRecording: Sendable {
    let samples: [MotionSample]
    let detectedReps: Int
    let reps: [CountedRep]
    let params: RepCounterParams
    let started: Bool

    var firstRepTime: Double? { reps.first?.time }
    var lastRepTime: Double? { reps.last?.time }

    /// API rep events: offsetMs from the first rep.
    var repEvents: [RepEvent] {
        guard let first = reps.first?.time else { return [] }
        return reps.enumerated().map { i, r in
            RepEvent(
                repIndex: i,
                offsetMs: max(0, Int(((r.time - first) * 1000).rounded())),
                concentricMs: r.concentricSec.map { Int(($0 * 1000).rounded()) }
            )
        }
    }
}

extension SetRecording {
    /// Rep events for a user-corrected count: truncates, or pads with reps spaced by the
    /// set's median detected interval (2.5 s if fewer than 2 reps were detected).
    func repEvents(adjustedTo n: Int) -> [RepEvent] {
        RepEvent.adjust(repEvents, to: n)
    }
}

extension RepEvent {
    static func adjust(_ events: [RepEvent], to n: Int, fallbackSpacingMs: Int = 2500) -> [RepEvent] {
        guard n > 0 else { return [] }
        if events.count >= n { return Array(events.prefix(n)) }
        let gaps = zip(events, events.dropFirst()).map { $1.offsetMs - $0.offsetMs }.filter { $0 > 0 }.sorted()
        let spacing = gaps.isEmpty ? fallbackSpacingMs : gaps[gaps.count / 2]
        var out = events
        var t = events.last.map { $0.offsetMs + spacing } ?? 0
        while out.count < n {
            out.append(RepEvent(repIndex: out.count, offsetMs: t))
            t += spacing
        }
        return out
    }
}

// MARK: - Biquad (RBJ cookbook, Butterworth Q)

struct Biquad: Sendable {
    enum Kind { case lowPass, highPass }
    private let b0: Double, b1: Double, b2: Double, a1: Double, a2: Double
    private var z1 = 0.0, z2 = 0.0

    init(_ kind: Kind, cutoff f0: Double, sampleRate fs: Double, q: Double = 1 / 2.0.squareRoot()) {
        let w0 = 2 * Double.pi * f0 / fs
        let c = cos(w0)
        let alpha = sin(w0) / (2 * q)
        let a0 = 1 + alpha
        let nb0: Double, nb1: Double, nb2: Double
        switch kind {
        case .lowPass:
            nb0 = (1 - c) / 2; nb1 = 1 - c; nb2 = (1 - c) / 2
        case .highPass:
            nb0 = (1 + c) / 2; nb1 = -(1 + c); nb2 = (1 + c) / 2
        }
        b0 = nb0 / a0; b1 = nb1 / a0; b2 = nb2 / a0
        a1 = (-2 * c) / a0; a2 = (1 - alpha) / a0
    }

    mutating func step(_ x: Double) -> Double {
        let y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        return y
    }
}

// MARK: - Counter

/// Not thread-safe: drive it from ONE serial queue (MotionRepSession uses the motion queue).
final class RepCounter {
    // Fixed tuning (not learned). Mirrored 1:1 in the Python simulation used to tune them.
    static let gravity = 9.80665
    static let velocityScale = 0.3      // m/s  → 1.0 normalized
    static let rotationScale = 1.5      // rad/s → 1.0 normalized
    static let highPassHz = 0.1
    static let lowPassHz = 2.5
    static let leakTau = 2.0
    static let axisTau = 2.0
    static let mergeGap = 0.6
    static let maxCycle = 12.0
    static let idleTimeout = 10.0
    static let consistency = 0.6
    static let maxIntraGap = 1.5
    static let minLobeSec = 0.4
    static let startMinCycle = 1.2
    // Recording window.
    static let preRollSec = 30.0
    static let leadInSec = 5.0
    static let maxRecordSec = 300.0

    private struct Half {
        let polarity: Int
        var peak: Double
        var peakTime: Double
        let start: Double
        var end: Double

        mutating func merge(_ o: Half) {
            if o.peak > peak { peak = o.peak; peakTime = o.peakTime }
            end = max(end, o.end)
        }
    }

    var params: RepCounterParams
    let sampleRate: Double
    private let recordingEnabled: Bool

    // Filters.
    private var hpV: Biquad, lpV: Biquad
    private var hpR: [Biquad], lpR: [Biquad]
    private var leaky = 0.0
    private var cov: [[Double]] = Array(repeating: Array(repeating: 0.0, count: 3), count: 3)
    private var axis: [Double] = [1, 0, 0]
    private var corr = 0.0
    private var rotSign = 1.0
    private var lastT: Double?

    /// Latest combined signal (normalized) — handy for an effort meter.
    private(set) var signal = 0.0

    // Lobe detector.
    private var lobePol = 0
    private var lobePeak = 0.0
    private var lobePeakTime = 0.0
    private var lobeStart = 0.0

    // Set state.
    private(set) var isStarted = false
    private(set) var isEnded = false
    private var halves: [Half] = []
    private var polarity = 1
    private var pending: Half?
    private var lastSecond: Half?
    private(set) var reps: [CountedRep] = []
    private var peaks: [Double] = []
    private var lastActivity: Double?
    private var setStartTime: Double?

    private(set) var recording: [MotionSample] = []

    var count: Int { reps.count }

    init(params: RepCounterParams = .default, sampleRate: Double = 50, recordingEnabled: Bool = true) {
        self.params = params
        self.sampleRate = sampleRate
        self.recordingEnabled = recordingEnabled
        let hp = Biquad(.highPass, cutoff: RepCounter.highPassHz, sampleRate: sampleRate)
        let lp = Biquad(.lowPass, cutoff: RepCounter.lowPassHz, sampleRate: sampleRate)
        hpV = hp; lpV = lp
        hpR = [hp, hp, hp]   // value types: independent copies with fresh state
        lpR = [lp, lp, lp]
    }

    /// Re-run a recorded set with other params; returns the final count.
    static func replay(_ samples: [MotionSample], params: RepCounterParams, sampleRate: Double = 50) -> Int {
        let c = RepCounter(params: params, sampleRate: sampleRate, recordingEnabled: false)
        for s in samples { _ = c.process(s) }
        return c.count
    }

    /// Ends the current set: returns its recording and re-arms for the next set. Filter state
    /// is kept so detection continues seamlessly through rest.
    func finishSet() -> SetRecording {
        let rec = SetRecording(samples: recording, detectedReps: reps.count, reps: reps,
                               params: params, started: isStarted)
        resetSet()
        if let last = recording.last {
            let cutoff = last.t - Self.leadInSec
            if let idx = recording.firstIndex(where: { $0.t >= cutoff }), idx > 0 {
                recording.removeFirst(idx)
            }
        }
        return rec
    }

    private func resetSet() {
        isStarted = false
        isEnded = false
        halves = []
        polarity = 1
        pending = nil
        lastSecond = nil
        reps = []
        peaks = []
        lastActivity = nil
        setStartTime = nil
    }

    private func runningAmplitude() -> Double {
        guard isStarted, !peaks.isEmpty else { return 0 }
        let s = peaks.suffix(4).sorted()
        let n = s.count
        return n % 2 == 1 ? s[n / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2])
    }

    // MARK: Filtering

    private func filter(_ s: MotionSample) -> Double {
        let dt: Double
        if let lastT { dt = min(max(s.t - lastT, 0.005), 0.05) } else { dt = 1.0 / sampleRate }
        lastT = s.t

        let gn = (s.gx * s.gx + s.gy * s.gy + s.gz * s.gz).squareRoot()
        let av = gn > 0.1 ? (s.ax * s.gx + s.ay * s.gy + s.az * s.gz) / gn : 0
        leaky += (av * Self.gravity - leaky / Self.leakTau) * dt
        let vel = lpV.step(hpV.step(leaky))

        let r = [s.rx, s.ry, s.rz]
        var rf = [0.0, 0.0, 0.0]
        for i in 0..<3 { rf[i] = lpR[i].step(hpR[i].step(r[i])) }

        let al = dt / Self.axisTau
        for i in 0..<3 {
            for j in 0..<3 { cov[i][j] += al * (rf[i] * rf[j] - cov[i][j]) }
        }
        var u = [0.0, 0.0, 0.0]
        for i in 0..<3 { u[i] = cov[i][0] * axis[0] + cov[i][1] * axis[1] + cov[i][2] * axis[2] }
        let n = (u[0] * u[0] + u[1] * u[1] + u[2] * u[2]).squareRoot()
        if n > 1e-9 {
            u = u.map { $0 / n }
            if u[0] * axis[0] + u[1] * axis[1] + u[2] * axis[2] < 0 { u = u.map { -$0 } }
            axis = u
        }
        let rot = rf[0] * axis[0] + rf[1] * axis[1] + rf[2] * axis[2]

        corr += al * (vel * rot - corr)
        if corr > 0.002 { rotSign = 1 } else if corr < -0.002 { rotSign = -1 }

        let w = min(max(params.rotationWeight, 0), 1)
        let cv = min(1, 2 * (1 - w))
        let cr = min(1, 2 * w)
        return cv * vel / Self.velocityScale + cr * rotSign * rot / Self.rotationScale
    }

    // MARK: Detection

    /// Feed one sample; returns any events it triggered (usually none).
    @discardableResult
    func process(_ s: MotionSample) -> [RepCounterEvent] {
        let t = s.t
        let x = filter(s)
        signal = x
        if recordingEnabled { record(s) }

        var events: [RepCounterEvent] = []
        if isEnded { return events }

        let lobeMin = max(params.noiseFloor, params.threshold * runningAmplitude())
        let zOn = 0.5 * lobeMin
        let zOff = 0.25 * lobeMin

        if lobePol != 0 {
            let v = Double(lobePol) * x
            if v > lobePeak { lobePeak = v; lobePeakTime = t }
            if v < zOff {
                if lobePeak >= lobeMin && t - lobeStart >= Self.minLobeSec {
                    events += accept(Half(polarity: lobePol, peak: lobePeak, peakTime: lobePeakTime,
                                          start: lobeStart, end: t))
                }
                lobePol = 0
            }
        }
        if lobePol == 0 && !isEnded {
            if x > zOn { lobePol = 1 } else if x < -zOn { lobePol = -1 }
            if lobePol != 0 { lobePeak = abs(x); lobePeakTime = t; lobeStart = t }
        }

        if isStarted, !isEnded, let la = lastActivity, t - la > Self.idleTimeout {
            isEnded = true
            lobePol = 0
            events.append(.setEnded(count: reps.count, time: t))
        }
        return events
    }

    private func accept(_ l: Half) -> [RepCounterEvent] {
        lastActivity = l.end

        if !isStarted {
            if let last = halves.last {
                if l.start - last.end > 6.0 {
                    halves.removeAll()
                } else if last.polarity == l.polarity {
                    if l.start - last.end < Self.mergeGap {
                        halves[halves.count - 1].merge(l)
                    } else {
                        halves[halves.count - 1] = l
                    }
                    return checkStart()
                }
            }
            halves.append(l)
            if halves.count > 6 { halves.removeFirst(halves.count - 6) }
            return checkStart()
        }

        peaks.append(l.peak)
        if peaks.count > 8 { peaks.removeFirst(peaks.count - 8) }

        var events: [RepCounterEvent] = []
        if l.polarity == polarity {
            if pending != nil { pending!.merge(l) } else { pending = l }
        } else if let first = pending {
            pending = nil
            let lastTime = reps.last?.time ?? -Double.greatestFiniteMagnitude
            if l.peakTime - lastTime >= params.minInterval {
                reps.append(CountedRep(time: l.peakTime, concentricSec: Self.concentric(first, l)))
                events.append(.rep(count: reps.count, time: l.peakTime))
            }
            lastSecond = l
        } else if lastSecond != nil {
            lastSecond!.merge(l)
        }
        return events
    }

    /// Negative polarity = moving up (gravity-aligned + is down) = the concentric for most lifts.
    private static func concentric(_ a: Half, _ b: Half) -> Double {
        let h = a.polarity < 0 ? a : b
        return h.end - h.start
    }

    private func consistent(_ a1: Half, _ b1: Half, _ a2: Half, _ b2: Half) -> Bool {
        let amp1 = a1.peak + b1.peak, amp2 = a2.peak + b2.peak
        let d1 = b1.end - a1.start, d2 = b2.end - a2.start
        if min(amp1, amp2) / max(amp1, amp2) < Self.consistency { return false }
        if min(d1, d2) / max(d1, d2) < Self.consistency { return false }
        if min(d1, d2) < max(params.minInterval, Self.startMinCycle) || max(d1, d2) > Self.maxCycle { return false }
        if a2.start - b1.end > max(2.0, d1) { return false }
        if b1.start - a1.end > Self.maxIntraGap || b2.start - a2.end > Self.maxIntraGap { return false }
        if b2.peakTime - b1.peakTime < params.minInterval { return false }
        return true
    }

    private func checkStart() -> [RepCounterEvent] {
        guard halves.count >= 4 else { return [] }
        let n = halves.count
        let a1 = halves[n - 4], b1 = halves[n - 3], a2 = halves[n - 2], b2 = halves[n - 1]
        guard consistent(a1, b1, a2, b2) else { return [] }
        isStarted = true
        polarity = a1.polarity
        reps = [
            CountedRep(time: b1.peakTime, concentricSec: Self.concentric(a1, b1)),
            CountedRep(time: b2.peakTime, concentricSec: Self.concentric(a2, b2)),
        ]
        peaks = [a1.peak, b1.peak, a2.peak, b2.peak]
        pending = nil
        lastSecond = b2
        setStartTime = a1.start
        halves.removeAll()
        return [.setStarted(count: 2, time: b2.peakTime)]
    }

    // MARK: Recording

    private func record(_ s: MotionSample) {
        recording.append(s)
        let cutoff: Double
        if isStarted, let st = setStartTime {
            cutoff = max(st - Self.leadInSec, s.t - Self.maxRecordSec)
        } else {
            cutoff = s.t - Self.preRollSec
        }
        // Trim in chunks (≥ 1 s of samples) to keep this amortized O(1).
        guard let first = recording.first, first.t < cutoff - 1.0 else { return }
        if let idx = recording.firstIndex(where: { $0.t >= cutoff }), idx > 0 {
            recording.removeFirst(idx)
        }
    }
}
