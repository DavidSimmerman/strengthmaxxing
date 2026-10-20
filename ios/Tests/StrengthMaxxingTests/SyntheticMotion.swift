//
//  SyntheticMotion.swift
//  Deterministic synthetic wrist-motion generator for the rep-counter tests.
//
//  Movements use minimum-jerk profiles (how humans actually move a load), converted to
//  what CoreMotion would report: userAcceleration (g, device frame), gravity unit vector,
//  rotationRate (rad/s). Noise comes from a seeded LCG so runs are reproducible.
//

import Foundation
#if canImport(StrengthMaxxingCore)
@testable import StrengthMaxxingCore
#endif

struct LCG {
    private var s: UInt64
    init(seed: UInt64) { s = seed }

    /// Uniform in [-1, 1).
    mutating func uniform() -> Double {
        s = s &* 6364136223846793005 &+ 1442695040888963407
        return (Double(s >> 11) / Double(UInt64(1) << 53)) * 2 - 1
    }

    /// Roughly normal noise with the given scale.
    mutating func noise(_ sd: Double) -> Double {
        let a = uniform(), b = uniform(), c = uniform()
        return sd * (a + b + c)
    }
}

enum MinJerk {
    /// Position, velocity, acceleration of a D-unit move over T seconds at normalized time tau.
    static func eval(D: Double, T: Double, tau rawTau: Double) -> (x: Double, v: Double, a: Double) {
        let tau = min(max(rawTau, 0), 1)
        let t2 = tau * tau, t3 = t2 * tau, t4 = t3 * tau, t5 = t4 * tau
        let x = D * (10 * t3 - 15 * t4 + 6 * t5)
        let v = D / T * (30 * t2 - 60 * t3 + 30 * t4)
        let a = D / (T * T) * (60 * tau - 180 * t2 + 120 * t3)
        return (x, v, a)
    }
}

/// A sequence of moves and holds along one coordinate (height in m, or angle in rad).
struct Profile {
    private var segs: [(start: Double, dur: Double, x0: Double, delta: Double)] = []
    private(set) var end: Double = 0
    private(set) var x: Double = 0

    @discardableResult
    mutating func move(_ dur: Double, _ delta: Double) -> Profile {
        segs.append((end, dur, x, delta))
        end += dur
        x += delta
        return self
    }

    @discardableResult
    mutating func hold(_ dur: Double) -> Profile { move(dur, 0) }

    func eval(_ t: Double) -> (x: Double, v: Double, a: Double) {
        for s in segs where s.start <= t && t < s.start + s.dur {
            let m = MinJerk.eval(D: s.delta, T: s.dur, tau: (t - s.start) / s.dur)
            return (s.x0 + m.x, m.v, m.a)
        }
        return (x, 0, 0)
    }

    static func hold(_ dur: Double) -> Profile {
        var p = Profile()
        p.hold(dur)
        return p
    }

    /// `reps` repetitions. upFirst: curl/press style (up, top hold, down, bottom hold);
    /// otherwise squat/bench style (down, bottom hold, up, top hold). `scales` shrinks
    /// individual reps (partials).
    static func reps(_ reps: Int, up: Double, top: Double, down: Double, bottom: Double,
                     distance D: Double, scales: [Double]? = nil, upFirst: Bool = true,
                     trailingHold: Double = 0) -> Profile {
        var p = Profile()
        for i in 0..<reps {
            let k = scales?[i] ?? 1
            if upFirst {
                p.move(up, D * k); p.hold(top); p.move(down, -D * k); p.hold(bottom)
            } else {
                p.move(down, -D * k); p.hold(bottom); p.move(up, D * k); p.hold(top)
            }
        }
        if trailingHold > 0 { p.hold(trailingHold) }
        return p
    }
}

enum Synth {
    static let g = 9.80665
    static let fs = 50.0

    static func count(_ duration: Double) -> Int { Int((duration * fs).rounded()) }

    /// Barbell-style: watch face fixed (device z points down), the load moves vertically.
    static func vertical(_ p: Profile, from t0: Double, rng: inout LCG,
                         accNoise: Double = 0.01, rotNoise: Double = 0.04) -> [MotionSample] {
        (0..<count(p.end)).map { i in
            let t = t0 + Double(i) / fs
            let hdd = p.eval(t - t0).a
            let az = -hdd / g + rng.noise(accNoise)
            let ax = rng.noise(accNoise), ay = rng.noise(accNoise)
            let rx = rng.noise(rotNoise), ry = rng.noise(rotNoise), rz = rng.noise(rotNoise)
            return MotionSample(t: t, ax: ax, ay: ay, az: az, gx: 0, gy: 0, gz: 1, rx: rx, ry: ry, rz: rz)
        }
    }

    /// Curl-style: `p` is the forearm angle (rad) about the device y axis; the device x axis
    /// runs along the forearm, `L` metres from the elbow (small L ⇒ rotation-dominant).
    static func curl(_ p: Profile, from t0: Double, rng: inout LCG, L: Double = 0.32,
                     accNoise: Double = 0.01, rotNoise: Double = 0.04) -> [MotionSample] {
        (0..<count(p.end)).map { i in
            let t = t0 + Double(i) / fs
            let e = p.eval(t - t0)
            let th = e.x, w = e.v, al = e.a
            let hdd = L * (cos(th) * w * w + sin(th) * al)
            let fdd = L * (-sin(th) * w * w + cos(th) * al)
            let ax = (-hdd * cos(th) + fdd * sin(th)) / g + rng.noise(accNoise)
            let az = (-hdd * sin(th) - fdd * cos(th)) / g + rng.noise(accNoise)
            let ay = rng.noise(accNoise)
            let rx = rng.noise(rotNoise), ry = w + rng.noise(rotNoise), rz = rng.noise(rotNoise)
            return MotionSample(t: t, ax: ax, ay: ay, az: az, gx: cos(th), gy: 0, gz: sin(th), rx: rx, ry: ry, rz: rz)
        }
    }

    /// Walking: footsteps (1.8 Hz vertical bounce, 0.15 g) + arm sway (0.9 Hz, 0.4 rad/s).
    static func walking(from t0: Double, duration: Double, rng: inout LCG) -> [MotionSample] {
        (0..<count(duration)).map { i in
            let t = t0 + Double(i) / fs
            let tt = Double(i) / fs
            let az = 0.15 * sin(2 * Double.pi * 1.8 * tt) + rng.noise(0.03)
            let ry = 0.4 * sin(2 * Double.pi * 0.9 * tt) + rng.noise(0.08)
            let ax = rng.noise(0.03), ay = rng.noise(0.03)
            let rx = rng.noise(0.08), rz = rng.noise(0.08)
            return MotionSample(t: t, ax: ax, ay: ay, az: az, gx: 0, gy: 0, gz: 1, rx: rx, ry: ry, rz: rz)
        }
    }

    static func still(from t0: Double, duration: Double, rng: inout LCG) -> [MotionSample] {
        vertical(Profile.hold(duration), from: t0, rng: &rng)
    }
}

extension RepCounter {
    /// Feeds all samples, returning every event emitted.
    @discardableResult
    func feed(_ samples: [MotionSample]) -> [RepCounterEvent] {
        var out: [RepCounterEvent] = []
        for s in samples { out += process(s) }
        return out
    }
}
