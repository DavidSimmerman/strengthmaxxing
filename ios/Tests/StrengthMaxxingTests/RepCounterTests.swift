//
//  RepCounterTests.swift
//  StrengthMaxxingTests
//
//  Deterministic tests for the peak-detection rep counter. Because RepCounter is pure
//  (it consumes (magnitude, time) samples and has no CoreMotion dependency), we can drive
//  it with a synthetic signal: a quiet baseline plus N acceleration "bursts" that model
//  concentric reps, and assert it counts exactly N.
//
//  These run with XCTest on the Mac (add this file to a test target). They are the fastest
//  way to sanity-check the detector's thresholds after tuning RepCounterConfig.
//

import XCTest
@testable import StrengthMaxxing

final class RepCounterTests: XCTestCase {

    /// Build a signal: `reps` bursts, each a raised-cosine bump of height `peakG`,
    /// spaced `periodS` apart, sampled at `hz`, over quiet noise `noiseG`.
    private func feed(
        _ counter: RepCounter,
        reps: Int,
        peakG: Double = 0.45,
        periodS: Double = 2.0,
        burstS: Double = 0.6,
        hz: Double = 50,
        noiseG: Double = 0.03
    ) {
        let dt = 1.0 / hz
        let totalS = Double(reps) * periodS + 2.0  // leading + trailing quiet
        var t = 0.0
        var rng = SystemRandomNumberGenerator()
        while t < totalS {
            var mag = noiseG * Double.random(in: 0...1, using: &rng)
            // Is t inside a burst window?
            for r in 0..<reps {
                let start = 1.0 + Double(r) * periodS  // 1s of quiet lead-in
                if t >= start && t <= start + burstS {
                    let phase = (t - start) / burstS  // 0..1
                    // Raised cosine bump peaks in the middle.
                    let bump = 0.5 * (1 - cos(2 * .pi * phase))
                    mag += peakG * bump
                }
            }
            counter.addSample(magnitude: mag, at: t)
            t += dt
        }
    }

    func testCountsExactRepsForCleanSignal() {
        let counter = RepCounter()
        feed(counter, reps: 8)
        XCTAssertEqual(counter.count, 8, "Expected 8 reps, got \(counter.count)")
    }

    func testCountsFiveReps() {
        let counter = RepCounter()
        feed(counter, reps: 5, peakG: 0.6, periodS: 2.5)
        XCTAssertEqual(counter.count, 5)
    }

    func testRefractoryRejectsDoubleCount() {
        // Bursts spaced closer than the refractory period should not double count each rep,
        // but with a healthy gap we still get one per burst.
        let counter = RepCounter(config: {
            var c = RepCounterConfig.default
            c.refractory = 0.9
            return c
        }())
        feed(counter, reps: 6, periodS: 2.0, burstS: 0.4)
        XCTAssertEqual(counter.count, 6)
    }

    func testQuietSignalCountsZero() {
        let counter = RepCounter()
        // Only noise, no bursts.
        let dt = 1.0 / 50.0
        var t = 0.0
        while t < 10 {
            counter.addSample(magnitude: 0.02 * Double.random(in: 0...1), at: t)
            t += dt
        }
        XCTAssertEqual(counter.count, 0)
    }

    func testRepEventsOffsetsAreMonotonicFromZero() {
        let counter = RepCounter()
        feed(counter, reps: 4)
        let events = counter.repEvents()
        XCTAssertEqual(events.first?.offsetMs, 0, "First rep offset must be 0")
        for i in 1..<events.count {
            XCTAssertGreaterThan(events[i].offsetMs, events[i - 1].offsetMs)
        }
    }

    func testManualAdjustTrimsAndPads() {
        let counter = RepCounter()
        feed(counter, reps: 6)
        counter.adjustCount(to: 4)
        XCTAssertEqual(counter.count, 4)
        counter.adjustCount(to: 7)
        XCTAssertEqual(counter.count, 7)
        // Offsets remain monotonic after padding.
        let events = counter.repEvents()
        for i in 1..<events.count {
            XCTAssertGreaterThanOrEqual(events[i].offsetMs, events[i - 1].offsetMs)
        }
    }
}
