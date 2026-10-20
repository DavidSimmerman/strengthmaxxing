//
//  OutboxTests.swift
//  The watch must start and finish a whole workout offline, then sync in order.
//

import XCTest
import Foundation
#if canImport(StrengthMaxxingCore)
@testable import StrengthMaxxingCore
#endif

// MARK: - Fakes

private struct FakeHTTPError: Error { let status: Int }
private struct OfflineError: Error {}

private final class TestClock: @unchecked Sendable {
    var t: Double = 1_000
}

private final class MemoryPersistence: OutboxPersistence, @unchecked Sendable {
    var state: OutboxState?
    var blobs: [String: Data] = [:]
    func loadState() -> OutboxState? { state }
    func saveState(_ state: OutboxState) { self.state = state }
    func writeBlob(_ data: Data, name: String) { blobs[name] = data }
    func readBlob(name: String) -> Data? { blobs[name] }
    func deleteBlob(name: String) { blobs[name] = nil }
}

private actor FakeTransport: OutboxTransport {
    var online = false
    var calls: [String] = []
    var setSessionIds: [Int] = []
    var sessionClientIds: [String?] = []
    var failNextWithStatus: Int?
    var nextSessionId = 77

    func setOnline(_ v: Bool) { online = v }
    func failNext(status: Int) { failNextWithStatus = status }

    private func gate() throws {
        guard online else { throw OfflineError() }
        if let s = failNextWithStatus { failNextWithStatus = nil; throw FakeHTTPError(status: s) }
    }

    func createSession(_ body: CreateSessionBody) async throws -> Int {
        sessionClientIds.append(body.clientId)
        try gate()
        calls.append("createSession")
        return nextSessionId
    }
    func addSet(sessionId: Int, _ body: CreateSetBody) async throws {
        try gate()
        calls.append("addSet:\(body.setIndex)")
        setSessionIds.append(sessionId)
    }
    func finishSession(sessionId: Int, _ body: FinishSessionBody) async throws {
        try gate()
        calls.append("finish:\(sessionId)")
    }
    func putCalibration(exerciseId: Int, _ body: CalibrationPutBody) async throws {
        try gate()
        calls.append("calibration:\(exerciseId)")
    }
    func postMotionTrace(json: Data) async throws {
        try gate()
        calls.append("trace:\(json.count)")
    }
    nonisolated func isPermanentFailure(_ error: Error) -> Bool {
        if let e = error as? FakeHTTPError { return (400..<500).contains(e.status) && e.status != 401 }
        return false
    }
}

private func setBody(_ i: Int, rpe: Double? = nil) -> CreateSetBody {
    CreateSetBody(exerciseId: 5, setIndex: i, supersetGroup: nil, reps: 8, weightKg: 102.06, rpe: rpe,
                  isWarmup: false, restSecActual: i == 0 ? nil : 150, startedAt: 1_720_000_000_000,
                  completedAt: 1_720_000_030_000, repEvents: [RepEvent(repIndex: 0, offsetMs: 0)],
                  clientId: UUID().uuidString)
}

// MARK: - Tests

final class OutboxTests: XCTestCase {

    func testWholeWorkoutOfflineThenSyncsInOrder() async throws {
        let clock = TestClock()
        let store = MemoryPersistence()
        let transport = FakeTransport()
        let outbox = Outbox(persistence: store, transport: transport, now: { clock.t })

        let session = UUID()
        await outbox.enqueue(.createSession(clientId: session, body: CreateSessionBody(
            workoutId: 1, name: "Push A", source: "watch", bodyweightKg: 80, readinessScore: nil,
            clientId: session.uuidString, startedAt: 1_720_000_000_000)))
        await outbox.enqueue(.addSet(sessionClientId: session, body: setBody(0)))
        await outbox.enqueue(.addSet(sessionClientId: session, body: setBody(1)))
        await outbox.enqueue(.putCalibration(exerciseId: 5, body: CalibrationPutBody(params: .default, samples: 1)))
        await outbox.enqueueMotionTrace(json: Data("{\"samples\":[]}".utf8))
        await outbox.enqueue(.finishSession(sessionClientId: session, body: FinishSessionBody(notes: nil, bodyweightKg: 80)))

        // Offline: nothing delivered, everything kept, backoff scheduled.
        var report = await outbox.flush()
        XCTAssertEqual(report.delivered, 0)
        XCTAssertEqual(report.remaining, 6)
        XCTAssertEqual(report.retryAt, 1_002)
        XCTAssertEqual(store.blobs.count, 1)

        // Still backing off → no attempt.
        await transport.setOnline(true)
        report = await outbox.flush()
        XCTAssertEqual(report.delivered, 0)

        clock.t += 3
        report = await outbox.flush()
        XCTAssertEqual(report.delivered, 6)
        XCTAssertEqual(report.remaining, 0)
        let calls = await transport.calls
        XCTAssertEqual(calls, ["createSession", "addSet:0", "addSet:1", "calibration:5", "trace:14", "finish:77"])
        let setIds = await transport.setSessionIds
        XCTAssertEqual(setIds, [77, 77])
        let mapped = await outbox.serverSessionId(for: session)
        XCTAssertEqual(mapped, 77)
        XCTAssertTrue(store.blobs.isEmpty, "trace blob deleted after upload")
    }

    func testQueueSurvivesRestart() async {
        let clock = TestClock()
        let store = MemoryPersistence()
        let transport = FakeTransport()
        let session = UUID()
        do {
            let outbox = Outbox(persistence: store, transport: transport, now: { clock.t })
            await outbox.enqueue(.createSession(clientId: session, body: CreateSessionBody(
                workoutId: nil, name: nil, source: "watch", bodyweightKg: nil, readinessScore: nil,
                clientId: session.uuidString)))
            await outbox.enqueue(.addSet(sessionClientId: session, body: setBody(0)))
            await outbox.flush()
        }
        // "App relaunch": a fresh Outbox over the same persistence.
        await transport.setOnline(true)
        clock.t += 10
        let reborn = Outbox(persistence: store, transport: transport, now: { clock.t })
        let pending = await reborn.pendingCount
        XCTAssertEqual(pending, 2)
        let report = await reborn.flush()
        XCTAssertEqual(report.delivered, 2)
        // Same clientId on the retry → server dedupes (idempotent create).
        let ids = await transport.sessionClientIds
        XCTAssertEqual(ids, [session.uuidString, session.uuidString])
    }

    func testPermanentFailureIsDeadLetteredAndDoesNotBlock() async {
        let clock = TestClock()
        let store = MemoryPersistence()
        let transport = FakeTransport()
        await transport.setOnline(true)
        let outbox = Outbox(persistence: store, transport: transport, now: { clock.t })
        await outbox.enqueue(.putCalibration(exerciseId: 1, body: CalibrationPutBody(params: .default, samples: 1)))
        await outbox.enqueue(.putCalibration(exerciseId: 2, body: CalibrationPutBody(params: .default, samples: 1)))
        await transport.failNext(status: 400)
        let report = await outbox.flush()
        XCTAssertEqual(report.dropped, 1)
        XCTAssertEqual(report.delivered, 1)
        let dead = await outbox.deadLetters
        XCTAssertEqual(dead.count, 1)

        // Requeue puts the op back and it can be delivered later.
        await outbox.requeueDeadLetters()
        let again = await outbox.flush()
        XCTAssertEqual(again.delivered, 1)
        let calls = await transport.calls
        XCTAssertEqual(calls, ["calibration:2", "calibration:1"])
    }

    func testUnauthorizedIsRetriedNotDropped() async {
        let clock = TestClock()
        let transport = FakeTransport()
        await transport.setOnline(true)
        let outbox = Outbox(persistence: MemoryPersistence(), transport: transport, now: { clock.t })
        await outbox.enqueue(.putCalibration(exerciseId: 1, body: CalibrationPutBody(params: .default, samples: 1)))
        await transport.failNext(status: 401)
        let r1 = await outbox.flush()
        XCTAssertEqual(r1.dropped, 0)
        XCTAssertEqual(r1.remaining, 1)
        clock.t += 5
        let r2 = await outbox.flush()
        XCTAssertEqual(r2.delivered, 1)
    }

    func testSetForUnknownSessionIsDeadLettered() async {
        let transport = FakeTransport()
        await transport.setOnline(true)
        let outbox = Outbox(persistence: MemoryPersistence(), transport: transport)
        await outbox.enqueue(.addSet(sessionClientId: UUID(), body: setBody(0)))
        let r = await outbox.flush()
        XCTAssertEqual(r.dropped, 1)
        let dead = await outbox.deadLetters
        XCTAssertNotNil(dead.first?.op, "payload kept for requeue")
    }

    func testBackoffGrowsAndCaps() {
        XCTAssertEqual(Outbox.backoff(attempts: 1), 2)
        XCTAssertEqual(Outbox.backoff(attempts: 2), 4)
        XCTAssertEqual(Outbox.backoff(attempts: 5), 32)
        XCTAssertEqual(Outbox.backoff(attempts: 20), 300)
    }

    func testFileStoreRoundTrip() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("smx-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: dir) }
        let p = FileOutboxPersistence(store: FileStore(directory: dir))
        var s = OutboxState()
        let session = UUID()
        s.items.append(OutboxItem(id: UUID(), op: .addSet(sessionClientId: session, body: setBody(3)),
                                  attempts: 2, notBefore: 5, lastError: "offline"))
        s.sessionIds[session.uuidString] = 9
        p.saveState(s)
        let loaded = try XCTUnwrap(p.loadState())
        XCTAssertEqual(loaded.items.count, 1)
        XCTAssertEqual(loaded.items.first?.attempts, 2)
        XCTAssertEqual(loaded.sessionIds[session.uuidString], 9)
        guard case let .addSet(c, body)? = loaded.items.first?.op else { return XCTFail("wrong op") }
        XCTAssertEqual(c, session)
        XCTAssertEqual(body.setIndex, 3)
    }

    // MARK: Wire format

    func testSetBodySendsExplicitNullRpeAndClientId() throws {
        let data = try JSONEncoder().encode(setBody(0))
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(obj["rpe"] is NSNull, "rpe must be null unless the user set it")
        XCTAssertTrue(obj["restSecActual"] is NSNull)
        XCTAssertTrue(obj["supersetGroup"] is NSNull)
        XCTAssertNotNil(obj["clientId"] as? String)
        XCTAssertEqual(obj["reps"] as? Int, 8)

        let withRpe = try JSONSerialization.jsonObject(with: JSONEncoder().encode(setBody(1, rpe: 8.5))) as? [String: Any]
        XCTAssertEqual(withRpe?["rpe"] as? Double, 8.5)
        XCTAssertEqual(withRpe?["restSecActual"] as? Int, 150)
    }

    func testServerSettingsDefaults() throws {
        let s = try JSONDecoder().decode(ServerSettings.self, from: Data("{}".utf8))
        XCTAssertEqual(s, ServerSettings(units: .lb, voiceCount: true, restAlarmSnoozeSec: 60))
        let k = try JSONDecoder().decode(ServerSettings.self, from: Data(#"{"units":"kg","voiceCount":false}"#.utf8))
        XCTAssertEqual(k.units, .kg)
        XCTAssertFalse(k.voiceCount)
    }

    func testMotionTraceBodyShape() throws {
        let samples = [MotionSample(t: 100.0, ax: 0.123456, gz: 1), MotionSample(t: 100.02, az: -0.5, gz: 1, ry: 1.5)]
        let body = MotionTraceBody(exerciseId: 5, setClientId: "abc", sampleHz: 50, detectedReps: 8,
                                   actualReps: 10, params: .default, motion: samples)
        XCTAssertEqual(body.samples.count, 2)
        XCTAssertEqual(body.samples[0].count, 10)
        XCTAssertEqual(body.samples[0][0], 0)
        XCTAssertEqual(body.samples[1][0], 20)
        XCTAssertEqual(body.samples[0][1], 0.1235)
        XCTAssertEqual(body.samples[1][8], 1.5)
        let obj = try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as? [String: Any]
        XCTAssertEqual(obj?["actualReps"] as? Int, 10)
        XCTAssertNotNil(obj?["params"] as? [String: Any])
    }
}
