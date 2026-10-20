//
//  RestAlarmTests.swift
//

import XCTest
#if canImport(StrengthMaxxingCore)
@testable import StrengthMaxxingCore
#endif

final class RestAlarmTests: XCTestCase {

    private func buzzes(_ effects: [RestAlarm.Effect]) -> Int {
        effects.filter { if case .buzz = $0 { return true }; return false }.count
    }

    func testCountdownThenRepeatingBuzzUntilDismissed() {
        var a = RestAlarm(snoozeSec: 60, buzzInterval: 1.2)
        XCTAssertEqual(a.start(restSec: 90, now: 0), [.scheduleFallback(at: 90)])
        XCTAssertEqual(a.phase, .resting)
        XCTAssertEqual(a.remaining(now: 30), 60)

        var t = 0.0
        var total = 0
        while t < 89.9 { total += buzzes(a.tick(now: t)); t += 0.25 }
        XCTAssertEqual(total, 0, "silent during rest")

        XCTAssertEqual(a.tick(now: 90), [.buzz(index: 0)])
        XCTAssertEqual(a.phase, .alarming)
        // Keeps buzzing every ~1.2 s — an alarm, not one tap.
        total = 0
        t = 90.25
        while t <= 96 { total += buzzes(a.tick(now: t)); t += 0.25 }
        XCTAssertEqual(total, 5)
        XCTAssertEqual(a.overRest(now: 96), 6)
    }

    func testDismissSnoozesThenAlarmsAgain() {
        var a = RestAlarm(snoozeSec: 60)
        _ = a.start(restSec: 10, now: 0)
        _ = a.tick(now: 10)
        XCTAssertEqual(a.dismiss(now: 12), [.scheduleFallback(at: 72)])
        XCTAssertEqual(a.phase, .snoozed)
        XCTAssertTrue(a.tick(now: 40).isEmpty)
        XCTAssertEqual(a.overRest(now: 40), 30)          // still showing time over rest
        XCTAssertEqual(buzzes(a.tick(now: 72)), 1)
        XCTAssertEqual(a.phase, .alarming)
        // Dismiss again → snooze again, repeat until a set starts.
        _ = a.dismiss(now: 75)
        XCTAssertEqual(a.phase, .snoozed)
        XCTAssertEqual(buzzes(a.tick(now: 135)), 1)
    }

    func testSetStartedStopsAlarmFromAnyActiveState() {
        for stage in 0..<3 {
            var a = RestAlarm(snoozeSec: 60)
            _ = a.start(restSec: 10, now: 0)
            if stage >= 1 { _ = a.tick(now: 10) }        // alarming
            if stage >= 2 { _ = a.dismiss(now: 11) }    // snoozed
            XCTAssertEqual(a.setStarted(), [.cancelFallback])
            XCTAssertEqual(a.phase, .done)
            XCTAssertTrue(a.tick(now: 500).isEmpty, "no buzz after the set started")
        }
    }

    func testAdjustAndSkip() {
        var a = RestAlarm()
        _ = a.start(restSec: 60, now: 0)
        XCTAssertEqual(a.adjust(by: 30, now: 10), [.scheduleFallback(at: 90)])
        XCTAssertTrue(a.tick(now: 60).isEmpty)
        XCTAssertEqual(a.skip(), [.cancelFallback])
        XCTAssertEqual(a.skip(), [])                     // idempotent
        XCTAssertFalse(a.isActive)
    }

    func testDismissOnlyWhileAlarming() {
        var a = RestAlarm()
        _ = a.start(restSec: 60, now: 0)
        XCTAssertTrue(a.dismiss(now: 5).isEmpty)
        XCTAssertEqual(a.phase, .resting)
    }

    func testLongSuspensionBuzzesOnceNotABurst() {
        var a = RestAlarm(buzzInterval: 1.2)
        _ = a.start(restSec: 1, now: 0)
        _ = a.tick(now: 1)
        XCTAssertEqual(buzzes(a.tick(now: 30)), 1)
        XCTAssertTrue(a.tick(now: 30.1).isEmpty)
    }
}
