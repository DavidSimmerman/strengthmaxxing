//
//  CalibratorTests.swift
//

import XCTest
#if canImport(StrengthMaxxingCore)
@testable import StrengthMaxxingCore
#endif

final class CalibratorTests: XCTestCase {

    /// 10 squats where the last two are fatigue partials (~30% range): default params count 8.
    static func partialsSet(seed: UInt64 = 5) -> [MotionSample] {
        var rng = LCG(seed: seed)
        var s = Synth.still(from: 0, duration: 3, rng: &rng)
        let scales: [Double] = [1, 1, 1, 1, 1, 1, 1, 1, 0.3, 0.28]
        let p = Profile.reps(10, up: 1.2, top: 0.3, down: 1.4, bottom: 0.4, distance: 0.40,
                             scales: scales, upFirst: false, trailingHold: 3)
        s += Synth.vertical(p, from: 3, rng: &rng)
        return s
    }

    func testCorrectionRefitsToExactCount() throws {
        let samples = Self.partialsSet()
        XCTAssertEqual(RepCounter.replay(samples, params: .default), 8, "default params miss the 2 partials")

        // User corrects 8 → 10.
        let fit = try XCTUnwrap(Calibrator.refit(samples: samples, targetCount: 10, current: .default))
        XCTAssertTrue(fit.isExact)
        XCTAssertEqual(fit.count, 10)

        var book = CalibrationBook()
        let entry = book.applyCorrection(exerciseId: 42, fitted: fit.params, now: 1000)
        XCTAssertEqual(entry.samples, 1)
        // First correction for a new exercise adopts the fit fully …
        XCTAssertEqual(book.params(for: 42), fit.params.clamped())
        // … and re-running the same set with the learned params is now exact.
        XCTAssertEqual(RepCounter.replay(samples, params: book.params(for: 42)), 10)

        // The learned params still count clean sets correctly.
        XCTAssertEqual(RepCounter.replay(RepCounterTests.slowThreeSecondSet(), params: book.params(for: 42)), 8)
        XCTAssertEqual(RepCounter.replay(RepCounterTests.heavySlowSet(), params: book.params(for: 42)), 5)
        // Other exercises are untouched.
        XCTAssertEqual(book.params(for: 7), .default)
    }

    func testRefitPrefersSmallestChangeWhenAlreadyRight() throws {
        let samples = RepCounterTests.slowThreeSecondSet()
        let fit = try XCTUnwrap(Calibrator.refit(samples: samples, targetCount: 8, current: .default))
        XCTAssertTrue(fit.isExact)
        XCTAssertLessThan(Calibrator.distance(fit.params, .default), 0.3)
    }

    func testRefitRejectsZeroTarget() {
        XCTAssertNil(Calibrator.refit(samples: RepCounterTests.slowThreeSecondSet(), targetCount: 0, current: .default))
    }

    func testBlendWeightShrinksWithSamplesButKeepsAFloor() {
        XCTAssertEqual(Calibrator.blendWeight(samples: 0), 1)
        XCTAssertEqual(Calibrator.blendWeight(samples: 1), 0.5)
        XCTAssertEqual(Calibrator.blendWeight(samples: 10), 0.25)

        // With history, one weird set moves the params only 25% of the way.
        var book = CalibrationBook()
        for i in 0..<10 { book.confirm(exerciseId: 1, now: Double(i)) }
        XCTAssertEqual(book.entry(for: 1)?.samples, 10)
        let weird = RepCounterParams(threshold: 0.8, minInterval: 2.0, rotationWeight: 1.0, noiseFloor: 0.25)
        book.applyCorrection(exerciseId: 1, fitted: weird, now: 20)
        let p = book.params(for: 1)
        XCTAssertEqual(p.threshold, 0.4 + (0.8 - 0.4) * 0.25, accuracy: 1e-9)
        XCTAssertEqual(p.rotationWeight, 0.5 + 0.5 * 0.25, accuracy: 1e-9)
        XCTAssertEqual(book.entry(for: 1)?.samples, 11)
    }

    func testMergeRemoteKeepsTheMoreExperiencedEntry() throws {
        var book = CalibrationBook()
        book.confirm(exerciseId: 1, now: 0)
        book.confirm(exerciseId: 1, now: 1)            // local samples = 2
        let json = """
        [{"exerciseId":1,"params":{"threshold":0.3},"samples":1,"updatedAt":"2026-10-01T00:00:00Z"},
         {"exerciseId":2,"params":{"threshold":0.5,"minInterval":1.4},"samples":4,"updatedAt":"2026-10-01T00:00:00Z"}]
        """.data(using: .utf8)!
        let remote = try JSONDecoder().decode([RemoteCalibration].self, from: json)
        book.merge(remote: remote, now: 5)
        XCTAssertEqual(book.params(for: 1), .default)  // local had more samples
        XCTAssertEqual(book.params(for: 2).threshold, 0.5)
        XCTAssertEqual(book.params(for: 2).minInterval, 1.4)
        XCTAssertEqual(book.entry(for: 2)?.samples, 4)
    }

    func testBookRoundTripsThroughJSON() throws {
        var book = CalibrationBook()
        book.applyCorrection(exerciseId: 3, fitted: RepCounterParams(threshold: 0.3), now: 9)
        let data = try JSONEncoder().encode(book)
        XCTAssertEqual(try JSONDecoder().decode(CalibrationBook.self, from: data), book)
    }
}
