//
//  UnitsTests.swift
//

import XCTest
#if canImport(StrengthMaxxingCore)
@testable import StrengthMaxxingCore
#endif

final class UnitsTests: XCTestCase {

    func testRoundTripPlateNumbersDisplayCleanly() {
        for lb in [45.0, 95, 135, 185, 225, 315, 405, 2.5, 27.5] {
            let kg = Units.toKg(lb, unit: .lb)
            XCTAssertEqual(Units.format(kg: kg, unit: .lb), "\(Units.formatNumber(lb)) lb")
        }
        XCTAssertEqual(Units.format(kg: Units.toKg(225, unit: .lb), unit: .lb), "225 lb")
        XCTAssertEqual(Units.format(kg: Units.toKg(227.5, unit: .lb), unit: .lb), "227.5 lb")
    }

    func testKgStoredValuesRoundToHalfPound() {
        XCTAssertEqual(Units.format(kg: 100, unit: .lb), "220.5 lb")   // 220.46
        XCTAssertEqual(Units.format(kg: 60, unit: .lb), "132.5 lb")    // 132.28
        XCTAssertEqual(Units.format(kg: 100, unit: .kg), "100 kg")
        XCTAssertEqual(Units.format(kg: 61.25, unit: .kg), "61.25 kg")
        XCTAssertEqual(Units.format(kg: 102.5, unit: .kg, withUnit: false), "102.5")
        XCTAssertEqual(Units.format(kg: 0, unit: .lb), "0 lb")
    }

    func testStepSizes() {
        XCTAssertEqual(Units.step(category: "barbell", unit: .lb), 5)
        XCTAssertEqual(Units.step(category: "machine", unit: .lb), 5)
        XCTAssertEqual(Units.step(category: "cable", unit: .lb), 2.5)
        XCTAssertEqual(Units.step(category: "dumbbell", unit: .lb), 2.5)
        XCTAssertEqual(Units.step(category: nil, unit: .lb), 5)
        XCTAssertEqual(Units.step(category: "barbell", unit: .kg), 2.5)
        XCTAssertEqual(Units.step(category: "dumbbell", unit: .kg), 2)
        XCTAssertEqual(Units.step(category: "bodyweight", unit: .kg), 1)
    }

    func testSteppingSnapsToGridAndNeverDrifts() {
        var kg = Units.toKg(225, unit: .lb)
        kg = Units.stepped(kg: kg, direction: 1, category: "barbell", unit: .lb)
        XCTAssertEqual(Units.format(kg: kg, unit: .lb), "230 lb")
        kg = Units.stepped(kg: kg, direction: -1, category: "barbell", unit: .lb)
        kg = Units.stepped(kg: kg, direction: -1, category: "barbell", unit: .lb)
        XCTAssertEqual(Units.format(kg: kg, unit: .lb), "220 lb")

        // 50 presses up and 50 down return exactly to the start.
        var k2 = Units.toKg(135, unit: .lb)
        for _ in 0..<50 { k2 = Units.stepped(kg: k2, direction: 1, category: "barbell", unit: .lb) }
        XCTAssertEqual(Units.format(kg: k2, unit: .lb), "385 lb")
        for _ in 0..<50 { k2 = Units.stepped(kg: k2, direction: -1, category: "barbell", unit: .lb) }
        XCTAssertEqual(Units.format(kg: k2, unit: .lb), "135 lb")

        // Off-grid kg value (100 kg = 220.46 lb) snaps to the neighbouring grid points.
        XCTAssertEqual(Units.format(kg: Units.stepped(kg: 100, direction: 1, category: "barbell", unit: .lb), unit: .lb), "225 lb")
        XCTAssertEqual(Units.format(kg: Units.stepped(kg: 100, direction: -1, category: "barbell", unit: .lb), unit: .lb), "220 lb")
        // Dumbbells follow the SelectTech 552: 2.5 lb to 25, then 5 lb, then 52.5 at the top.
        XCTAssertEqual(Units.format(kg: Units.stepped(kg: Units.toKg(50, unit: .lb), direction: 1, category: "dumbbell", unit: .lb), unit: .lb), "52.5 lb")
        XCTAssertEqual(Units.format(kg: Units.stepped(kg: Units.toKg(25, unit: .lb), direction: 1, category: "dumbbell", unit: .lb), unit: .lb), "30 lb")
        XCTAssertEqual(Units.format(kg: Units.stepped(kg: Units.toKg(30, unit: .lb), direction: -1, category: "dumbbell", unit: .lb), unit: .lb), "25 lb")
        XCTAssertEqual(Units.format(kg: Units.stepped(kg: Units.toKg(52.5, unit: .lb), direction: 1, category: "dumbbell", unit: .lb), unit: .lb), "52.5 lb")
        // Never negative.
        XCTAssertEqual(Units.stepped(kg: 0, direction: -1, category: "barbell", unit: .lb), 0)
        // kg mode.
        XCTAssertEqual(Units.stepped(kg: 100, direction: 1, category: "barbell", unit: .kg), 102.5, accuracy: 1e-9)
    }

    func testParse() {
        XCTAssertEqual(Units.parse("225", unit: .lb)!, 102.0582833, accuracy: 1e-6)
        XCTAssertEqual(Units.parse("102,5", unit: .kg)!, 102.5, accuracy: 1e-9)
        XCTAssertNil(Units.parse("abc", unit: .lb))
        XCTAssertNil(Units.parse("-5", unit: .lb))
    }
}

final class ISO8601Tests: XCTestCase {
    func testParsesServerTimestamps() {
        XCTAssertEqual(ISO8601.parse("2026-10-20T17:35:59.261Z")?.timeIntervalSince1970 ?? 0, 1792517759.261, accuracy: 0.001)
        XCTAssertEqual(ISO8601.parse("2026-10-20T17:35:59Z")?.timeIntervalSince1970, 1792517759)
        XCTAssertNil(ISO8601.parse(nil))
        XCTAssertNil(ISO8601.parse("yesterday"))
    }

    func testFinishBodyOmitsUnknownCalories() throws {
        let plain = String(data: try JSONEncoder().encode(FinishSessionBody(notes: nil, bodyweightKg: 80)), encoding: .utf8)!
        XCTAssertFalse(plain.contains("activeKcal"))
        XCTAssertFalse(plain.contains("kcalSource"))
        var b = FinishSessionBody(notes: nil, bodyweightKg: 80)
        b.activeKcal = 312; b.avgHr = 118; b.kcalSource = .appleWatch
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(b)) as! [String: Any]
        XCTAssertEqual(json["kcalSource"] as? String, "apple_watch")
        XCTAssertEqual(json["activeKcal"] as? Double, 312)
    }
}
