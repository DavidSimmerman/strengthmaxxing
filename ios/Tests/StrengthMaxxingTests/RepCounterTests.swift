//
//  RepCounterTests.swift
//  Synthetic-signal tests for the rep counter. Every scenario was also simulated with a
//  1:1 Python port across 30 noise seeds before being written here.
//

import XCTest
#if canImport(StrengthMaxxingCore)
@testable import StrengthMaxxingCore
#endif

final class RepCounterTests: XCTestCase {

    // MARK: Scenarios (shared with CalibratorTests)

    /// 8 slow 3-second reps (1.0 s up, 0.6 s hold, 1.2 s down, 0.2 s hold): each movement has
    /// a speed-up and a slow-down acceleration burst — the old |accel| peak detector counted
    /// those bursts separately.
    static func slowThreeSecondSet(seed: UInt64 = 1) -> [MotionSample] {
        var rng = LCG(seed: seed)
        var s = Synth.still(from: 0, duration: 3, rng: &rng)
        let p = Profile.reps(8, up: 1.0, top: 0.6, down: 1.2, bottom: 0.2, distance: 0.40, trailingHold: 3)
        s += Synth.vertical(p, from: 3, rng: &rng)
        return s
    }

    /// 5 heavy, grinding squats: 2 s down, 3 s up, 0.30 m of wrist travel. Peak acceleration
    /// stays far below the old fixed 0.12 g floor.
    static func heavySlowSet(seed: UInt64 = 2) -> [MotionSample] {
        var rng = LCG(seed: seed)
        var s = Synth.still(from: 0, duration: 3, rng: &rng)
        let p = Profile.reps(5, up: 3.0, top: 1.0, down: 2.0, bottom: 0.3, distance: 0.30,
                             upFirst: false, trailingHold: 3)
        s += Synth.vertical(p, from: 3, rng: &rng)
        return s
    }

    static let walkSetStart = 10.0

    /// 6 s walking to the bench, an unrack + settle, then 6 bench reps starting at t = 10 s.
    static func walkUnrackSet(seed: UInt64 = 3) -> [MotionSample] {
        var rng = LCG(seed: seed)
        var s = Synth.walking(from: 0, duration: 6, rng: &rng)
        var unrack = Profile()
        unrack.move(0.5, 0.06); unrack.hold(0.4); unrack.move(0.6, -0.03); unrack.hold(2.5)
        s += Synth.vertical(unrack, from: 6, rng: &rng)
        let p = Profile.reps(6, up: 0.9, top: 0.2, down: 1.1, bottom: 0.2, distance: 0.35,
                             upFirst: false, trailingHold: 3)
        s += Synth.vertical(p, from: 6 + unrack.end, rng: &rng)
        return s
    }

    /// 10 curls where the watch barely travels vertically (rotation carries the signal).
    static func rotationCurlSet(seed: UInt64 = 4) -> [MotionSample] {
        var rng = LCG(seed: seed)
        var s = Synth.curl(Profile.hold(3), from: 0, rng: &rng, L: 0.02)
        let p = Profile.reps(10, up: 1.0, top: 0.3, down: 1.4, bottom: 0.5, distance: 2.2, trailingHold: 3)
        s += Synth.curl(p, from: 3, rng: &rng, L: 0.02)
        return s
    }

    // MARK: Tests

    func testSlowThreeSecondRepsCountedOnce() {
        let c = RepCounter()
        let events = c.feed(Self.slowThreeSecondSet())
        XCTAssertEqual(c.count, 8)
        XCTAssertEqual(events.filter { if case .setStarted = $0 { return true }; return false }.count, 1)
        // Reps are reported in order with increasing counts.
        let counts = events.compactMap { e -> Int? in
            switch e { case .setStarted(let n, _), .rep(let n, _): return n; default: return nil }
        }
        XCTAssertEqual(counts, Array(2...8))
    }

    func testHeavySlowSmallAmplitudeRepsCounted() {
        let samples = Self.heavySlowSet()
        let peakAccel = samples.map { abs($0.az) }.max() ?? 0
        XCTAssertLessThan(peakAccel, 0.12, "scenario must be below the old fixed 0.12 g floor")
        let c = RepCounter()
        c.feed(samples)
        XCTAssertEqual(c.count, 5)
    }

    func testWalkingAndUnrackNotCountedAndStartDetectedAfterTwoReps() {
        let c = RepCounter()
        let events = c.feed(Self.walkUnrackSet())
        let starts = events.compactMap { e -> (Int, Double)? in
            if case let .setStarted(n, t) = e { return (n, t) }
            return nil
        }
        XCTAssertEqual(starts.count, 1)
        guard let start = starts.first else { return }
        // Started with the first 2 reps included, and only once the real set was underway.
        XCTAssertEqual(start.0, 2)
        XCTAssertGreaterThan(start.1, Self.walkSetStart)
        XCTAssertLessThan(start.1, Self.walkSetStart + 2 * 2.4 + 0.5) // by the end of rep 2
        // No rep events before the set started.
        for e in events {
            if case let .rep(_, t) = e { XCTAssertGreaterThan(t, start.1) }
        }
        XCTAssertEqual(c.count, 6)
        // The recording was trimmed to the set (+ ≤ 5 s lead-in), dropping the walk.
        let rec = c.finishSet()
        XCTAssertGreaterThanOrEqual(rec.samples.first?.t ?? 0, Self.walkSetStart - RepCounter.leadInSec - 1.5)
        XCTAssertEqual(rec.detectedReps, 6)
    }

    func testRotationDominantCurl() {
        let samples = Self.rotationCurlSet()
        let c = RepCounter()
        c.feed(samples)
        XCTAssertEqual(c.count, 10)
        // Vertical-only params can't see it: the rotation channel is doing the work.
        let verticalOnly = RepCounter.replay(samples, params: RepCounterParams(rotationWeight: 0))
        XCTAssertLessThan(verticalOnly, 10)
    }

    func testRobustAcrossNoiseSeeds() {
        for seed in UInt64(10)..<UInt64(16) {
            XCTAssertEqual(RepCounter.replay(Self.slowThreeSecondSet(seed: seed), params: .default), 8, "seed \(seed)")
            XCTAssertEqual(RepCounter.replay(Self.heavySlowSet(seed: seed), params: .default), 5, "seed \(seed)")
            XCTAssertEqual(RepCounter.replay(Self.walkUnrackSet(seed: seed), params: .default), 6, "seed \(seed)")
        }
    }

    func testRunsContinuouslyAcrossRestAndSetEnds() {
        var rng = LCG(seed: 7)
        var s = Synth.still(from: 0, duration: 3, rng: &rng)
        let set1 = Profile.reps(5, up: 1.0, top: 0.3, down: 1.2, bottom: 0.5, distance: 0.4, trailingHold: 20)
        s += Synth.vertical(set1, from: 3, rng: &rng)
        let t2 = 3 + set1.end
        let set2 = Profile.reps(7, up: 1.0, top: 0.3, down: 1.2, bottom: 0.5, distance: 0.4, trailingHold: 3)
        s += Synth.vertical(set2, from: t2, rng: &rng)

        let c = RepCounter()
        var events: [RepCounterEvent] = []
        var first: SetRecording?
        for sample in s {
            events += c.process(sample)
            if first == nil && sample.t >= t2 - 5 { first = c.finishSet() }  // user logs set 1 during rest
        }
        XCTAssertEqual(first?.detectedReps, 5)
        XCTAssertTrue(events.contains { if case .setEnded(5, _) = $0 { return true }; return false })
        XCTAssertEqual(c.count, 7)
    }

    func testRepEventsOffsetsFromFirstRep() {
        let c = RepCounter()
        c.feed(Self.slowThreeSecondSet())
        let rec = c.finishSet()
        let ev = rec.repEvents
        XCTAssertEqual(ev.count, 8)
        XCTAssertEqual(ev.first?.offsetMs, 0)
        XCTAssertEqual(ev.map(\.repIndex), Array(0..<8))
        for (a, b) in zip(ev, ev.dropFirst()) {
            // ~3 s apart.
            XCTAssertEqual(Double(b.offsetMs - a.offsetMs), 3000, accuracy: 250)
        }
        XCTAssertNotNil(ev.last?.concentricMs)
        // finishSet re-arms.
        XCTAssertEqual(c.count, 0)
        XCTAssertFalse(c.isStarted)
    }

    func testStillnessCountsNothing() {
        var rng = LCG(seed: 11)
        let c = RepCounter()
        let events = c.feed(Synth.still(from: 0, duration: 60, rng: &rng))
        XCTAssertTrue(events.isEmpty)
        XCTAssertEqual(c.count, 0)
        // Pre-roll keeps ≤ 30 s (+ trim slack) of samples while idle.
        XCTAssertLessThanOrEqual(c.recording.count, Int((RepCounter.preRollSec + 2) * 50))
    }

    func testCorrectedCountRepEventsKeepRealSpacing() {
        let detected = [0, 3000, 6100].enumerated().map { RepEvent(repIndex: $0.offset, offsetMs: $0.element) }
        let padded = RepEvent.adjust(detected, to: 5)
        XCTAssertEqual(padded.map(\.offsetMs), [0, 3000, 6100, 9200, 12300])  // median gap 3100
        XCTAssertEqual(padded.map(\.repIndex), [0, 1, 2, 3, 4])
        XCTAssertEqual(RepEvent.adjust(detected, to: 2).count, 2)
        XCTAssertEqual(RepEvent.adjust([], to: 3).map(\.offsetMs), [0, 2500, 5000])
        XCTAssertTrue(RepEvent.adjust(detected, to: 0).isEmpty)
    }

    func testParamsDecodeWithMissingKeysAndClamp() throws {
        let json = #"{"threshold": 5, "rotationWeight": 0.8}"#.data(using: .utf8)!
        let p = try JSONDecoder().decode(RepCounterParams.self, from: json)
        XCTAssertEqual(p.threshold, 0.9)               // clamped
        XCTAssertEqual(p.rotationWeight, 0.8)
        XCTAssertEqual(p.minInterval, RepCounterParams.default.minInterval)
    }
}
