import XCTest
@testable import StrengthMaxxingCore

final class HeartRateCaloriesTests: XCTestCase {
    let man = BodyProfile(weightKg: 80, ageYears: 35, sex: .male, heightCm: 177)

    /// One sample every 5 s at a fixed heart rate for `minutes`.
    func steady(_ bpm: Double, minutes: Double) -> [HeartRateSample] {
        stride(from: 0.0, to: minutes * 60, by: 5).map { HeartRateSample(t: $0, bpm: bpm) }
    }

    func testSteadyHourMatchesHandCalculation() throws {
        // Keytel male @ 110 bpm: (-55.0969 + 69.399 + 15.904 + 7.0595) / 4.184 = 8.907 kcal/min
        // BMR: 800 + 1106.25 - 175 + 5 = 1736.25 /day = 1.2057 /min → active 7.701 /min
        let r = try XCTUnwrap(HeartRateCalories.activeKcal(
            samples: steady(110, minutes: 60), start: 0, end: 3600, profile: man))
        XCTAssertEqual(r.kcal, 7.701 * 60, accuracy: 1)
        XCTAssertEqual(r.avgHr, 110, accuracy: 0.001)
    }

    func testRestingHeartRateBurnsNothingExtra() throws {
        let r = try XCTUnwrap(HeartRateCalories.activeKcal(
            samples: steady(65, minutes: 30), start: 0, end: 1800, profile: man))
        XCTAssertEqual(r.kcal, 0, accuracy: 0.001)
    }

    func testHeavierPersonBurnsMore() throws {
        var big = man; big.weightKg = 110
        let a = try XCTUnwrap(HeartRateCalories.activeKcal(samples: steady(115, minutes: 45), start: 0, end: 2700, profile: man))
        let b = try XCTUnwrap(HeartRateCalories.activeKcal(samples: steady(115, minutes: 45), start: 0, end: 2700, profile: big))
        XCTAssertGreaterThan(b.kcal, a.kcal)
    }

    func testUnknownSexSitsBetween() throws {
        var f = man; f.sex = .female; f.heightCm = nil
        var u = man; u.sex = .unknown; u.heightCm = nil
        var m = man; m.heightCm = nil
        let k = { (p: BodyProfile) in HeartRateCalories.activeKcal(samples: self.steady(120, minutes: 30), start: 0, end: 1800, profile: p)!.kcal }
        let (km, kf, ku) = (k(m), k(f), k(u))
        XCTAssertTrue(min(km, kf) <= ku && ku <= max(km, kf), "\(kf) ≤ \(ku) ≤ \(km)")
    }

    func testNoCliffAroundTheExerciseThreshold() {
        let basal = HeartRateCalories.bmr(man) / 1440
        let at = { (bpm: Double) in HeartRateCalories.activePerMin(bpm: bpm, self.man, basalPerMin: basal) }
        XCTAssertEqual(at(70), 0, accuracy: 0.001)
        XCTAssertLessThan(at(80), at(89))
        XCTAssertEqual(at(89.9), at(90), accuracy: 0.1)   // continuous at 90
        XCTAssertLessThan(at(90), at(100))
    }

    func testSparseDataFallsBackToNil() {
        // only the first 20 of 60 minutes have heart rate → 33% coverage
        XCTAssertNil(HeartRateCalories.activeKcal(samples: steady(110, minutes: 20), start: 0, end: 3600, profile: man))
        XCTAssertNil(HeartRateCalories.activeKcal(samples: [], start: 0, end: 3600, profile: man))
    }

    func testLongGapCountsOnlyTwoMinutes() throws {
        // samples at 0 and 600 s: the first stands for 120 s, not 600
        let s = [HeartRateSample(t: 0, bpm: 140), HeartRateSample(t: 600, bpm: 100)]
        XCTAssertNil(HeartRateCalories.activeKcal(samples: s, start: 0, end: 700, profile: man))
    }

    func testIgnoresSamplesOutsideWindowAndGarbage() throws {
        var s = steady(110, minutes: 60)
        s.append(HeartRateSample(t: -100, bpm: 180))
        s.append(HeartRateSample(t: 4000, bpm: 180))
        s.append(HeartRateSample(t: 1800.5, bpm: 0))
        let r = try XCTUnwrap(HeartRateCalories.activeKcal(samples: s, start: 0, end: 3600, profile: man))
        XCTAssertEqual(r.avgHr, 110, accuracy: 0.001)
    }

    func testTypicalLiftingSessionIsPlausible() throws {
        // 60 min alternating 40 s of lifting at ~130 bpm and 2 min rest at ~95 bpm
        var s: [HeartRateSample] = []
        var t = 0.0
        while t < 3600 {
            for _ in 0..<8 { s.append(.init(t: t, bpm: 130)); t += 5 }
            for _ in 0..<24 { s.append(.init(t: t, bpm: 95)); t += 5 }
        }
        let r = try XCTUnwrap(HeartRateCalories.activeKcal(samples: s, start: 0, end: 3600, profile: man))
        XCTAssertTrue((200...500).contains(r.kcal), "\(r.kcal) kcal for an hour of lifting")
    }
}
