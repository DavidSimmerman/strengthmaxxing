//
//  Outbox.swift
//  StrengthMaxxing (shared, PURE)
//
//  Ordered, persistent queue of API writes so a whole workout works with no network.
//  Every op is idempotent on the server (clientId UUIDs, see API_CONTRACT v2), so
//  retrying after an ambiguous failure is safe.
//
//  - Ops are delivered strictly in order. A retryable failure (offline, 5xx, 401…) stops the
//    flush and backs off exponentially (2 s … 5 min). A permanent failure (4xx validation)
//    moves the op to `deadLetters` so one bad op can't block the queue forever.
//  - `createSession` maps the session's clientId → server id; later `addSet`/`finish` ops
//    for that clientId use the mapped id.
//  - Motion traces can be large, so their JSON lives in a separate blob file.
//
//  Transport and persistence are injected: tests use in-memory fakes, the app uses
//  APIClient + FileStore.
//

import Foundation

enum OutboxOp: Codable, Sendable {
    case createSession(clientId: UUID, body: CreateSessionBody)
    case addSet(sessionClientId: UUID, body: CreateSetBody)
    case finishSession(sessionClientId: UUID, body: FinishSessionBody)
    case putCalibration(exerciseId: Int, body: CalibrationPutBody)
    /// JSON body stored in a blob named `blob`.
    case motionTrace(blob: String)

    var label: String {
        switch self {
        case .createSession: return "start session"
        case .addSet: return "log set"
        case .finishSession: return "finish session"
        case .putCalibration: return "save calibration"
        case .motionTrace: return "motion trace"
        }
    }
}

struct OutboxItem: Codable, Sendable {
    let id: UUID
    let op: OutboxOp
    var attempts: Int
    /// Epoch seconds before which we shouldn't retry.
    var notBefore: Double
    var lastError: String?
}

struct DeadLetter: Codable, Sendable {
    let label: String
    let error: String
    let at: Double
    /// Kept (except motion traces) so data is never silently lost; see `requeueDeadLetters`.
    let op: OutboxOp?
}

struct OutboxState: Codable, Sendable {
    var items: [OutboxItem] = []
    /// session clientId (uuidString) → server session id.
    var sessionIds: [String: Int] = [:]
    var deadLetters: [DeadLetter] = []
}

protocol OutboxTransport: Sendable {
    /// Returns the server session id.
    func createSession(_ body: CreateSessionBody) async throws -> Int
    func addSet(sessionId: Int, _ body: CreateSetBody) async throws
    func finishSession(sessionId: Int, _ body: FinishSessionBody) async throws
    func putCalibration(exerciseId: Int, _ body: CalibrationPutBody) async throws
    func postMotionTrace(json: Data) async throws
    /// True if retrying can never succeed (e.g. HTTP 400/404/409/413/422).
    func isPermanentFailure(_ error: Error) -> Bool
}

protocol OutboxPersistence: Sendable {
    func loadState() -> OutboxState?
    func saveState(_ state: OutboxState)
    func writeBlob(_ data: Data, name: String)
    func readBlob(name: String) -> Data?
    func deleteBlob(name: String)
}

/// FileStore-backed persistence: `outbox.json` + `blob-*.json`.
struct FileOutboxPersistence: OutboxPersistence {
    let store: FileStore
    func loadState() -> OutboxState? { store.load(OutboxState.self, "outbox.json") }
    func saveState(_ state: OutboxState) { store.save(state, "outbox.json") }
    func writeBlob(_ data: Data, name: String) { store.write(data, name) }
    func readBlob(name: String) -> Data? { store.data(name) }
    func deleteBlob(name: String) { store.remove(name) }
}

struct FlushReport: Equatable, Sendable {
    var delivered = 0
    var dropped = 0
    var remaining = 0
    /// Set when we stopped on a retryable failure: earliest time worth retrying.
    var retryAt: Double?
}

enum OutboxError: Error, Equatable {
    case unknownSession
    case missingBlob
}

actor Outbox {
    private var state: OutboxState
    private let persistence: OutboxPersistence
    private let transport: OutboxTransport
    private let now: @Sendable () -> Double
    private var isFlushing = false

    static let maxBackoff: Double = 300

    init(persistence: OutboxPersistence, transport: OutboxTransport,
         now: @escaping @Sendable () -> Double = { Date().timeIntervalSince1970 }) {
        self.persistence = persistence
        self.transport = transport
        self.now = now
        self.state = persistence.loadState() ?? OutboxState()
    }

    var pendingCount: Int { state.items.count }
    var deadLetters: [DeadLetter] { state.deadLetters }
    var pendingLabels: [String] { state.items.map { $0.op.label } }

    func serverSessionId(for clientId: UUID) -> Int? { state.sessionIds[clientId.uuidString] }

    func enqueue(_ op: OutboxOp) {
        state.items.append(OutboxItem(id: UUID(), op: op, attempts: 0, notBefore: 0, lastError: nil))
        persistence.saveState(state)
    }

    /// Queue a motion trace (any Encodable body, typically `MotionTraceBody`).
    func enqueueMotionTrace(json: Data) {
        let name = "blob-\(UUID().uuidString).json"
        persistence.writeBlob(json, name: name)
        enqueue(.motionTrace(blob: name))
    }

    /// Clears backoff so the next flush retries immediately (e.g. connectivity came back).
    func resetBackoff() {
        for i in state.items.indices { state.items[i].notBefore = 0 }
        persistence.saveState(state)
    }

    /// Put failed ops back at the end of the queue (e.g. after a server fix).
    func requeueDeadLetters() {
        let ops = state.deadLetters.compactMap { $0.op }
        state.deadLetters.removeAll()
        for op in ops {
            state.items.append(OutboxItem(id: UUID(), op: op, attempts: 0, notBefore: 0, lastError: nil))
        }
        persistence.saveState(state)
    }

    static func backoff(attempts: Int) -> Double {
        min(maxBackoff, 2 * pow(2, Double(max(attempts, 1) - 1)))
    }

    /// Deliver queued ops in order until empty or a retryable failure.
    @discardableResult
    func flush() async -> FlushReport {
        var report = FlushReport()
        guard !isFlushing else {
            report.remaining = state.items.count
            return report
        }
        isFlushing = true
        defer { isFlushing = false }

        while let item = state.items.first {
            if item.notBefore > now() {
                report.retryAt = item.notBefore
                break
            }
            do {
                try await deliver(item.op)
                remove(item.id, deleteBlobOf: item.op)
                report.delivered += 1
            } catch {
                let message = String(describing: error)
                if error is OutboxError || transport.isPermanentFailure(error) {
                    var kept: OutboxOp? = item.op
                    if case .motionTrace = item.op { kept = nil }
                    state.deadLetters.append(DeadLetter(label: item.op.label, error: message, at: now(), op: kept))
                    if state.deadLetters.count > 20 { state.deadLetters.removeFirst(state.deadLetters.count - 20) }
                    remove(item.id, deleteBlobOf: item.op)
                    report.dropped += 1
                } else if let idx = state.items.firstIndex(where: { $0.id == item.id }) {
                    state.items[idx].attempts += 1
                    state.items[idx].lastError = message
                    state.items[idx].notBefore = now() + Self.backoff(attempts: state.items[idx].attempts)
                    report.retryAt = state.items[idx].notBefore
                    persistence.saveState(state)
                    break
                }
            }
        }
        report.remaining = state.items.count
        return report
    }

    private func remove(_ id: UUID, deleteBlobOf op: OutboxOp) {
        state.items.removeAll { $0.id == id }
        if case .motionTrace(let blob) = op { persistence.deleteBlob(name: blob) }
        persistence.saveState(state)
    }

    private func sessionId(_ clientId: UUID) throws -> Int {
        guard let id = state.sessionIds[clientId.uuidString] else { throw OutboxError.unknownSession }
        return id
    }

    private func deliver(_ op: OutboxOp) async throws {
        switch op {
        case let .createSession(clientId, body):
            let id = try await transport.createSession(body)
            state.sessionIds[clientId.uuidString] = id
            trimSessionMap()
        case let .addSet(sessionClientId, body):
            try await transport.addSet(sessionId: try sessionId(sessionClientId), body)
        case let .finishSession(sessionClientId, body):
            try await transport.finishSession(sessionId: try sessionId(sessionClientId), body)
        case let .putCalibration(exerciseId, body):
            try await transport.putCalibration(exerciseId: exerciseId, body)
        case let .motionTrace(blob):
            guard let data = persistence.readBlob(name: blob) else { throw OutboxError.missingBlob }
            try await transport.postMotionTrace(json: data)
        }
    }

    /// Keep the clientId→id map bounded, but never drop ids still referenced by queued ops.
    private func trimSessionMap() {
        guard state.sessionIds.count > 50 else { return }
        var referenced = Set<String>()
        for item in state.items {
            switch item.op {
            case let .createSession(c, _): referenced.insert(c.uuidString)
            case let .addSet(c, _), let .finishSession(c, _): referenced.insert(c.uuidString)
            default: break
            }
        }
        for key in state.sessionIds.keys where !referenced.contains(key) && state.sessionIds.count > 50 {
            state.sessionIds.removeValue(forKey: key)
        }
    }
}
