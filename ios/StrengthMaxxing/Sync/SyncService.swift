//
//  SyncService.swift
//  StrengthMaxxing (shared)
//
//  App-side glue around the pure `Outbox`:
//   - APIOutboxTransport: delivers outbox ops with APIClient.
//   - SyncService: enqueues in order, flushes with backoff, and refreshes the offline
//     caches (workout list, server settings, calibration) when the server is reachable.
//

import Foundation
import Combine

struct APIOutboxTransport: OutboxTransport {
    let api: APIClient

    func createSession(_ body: CreateSessionBody) async throws -> Int {
        try await api.startSessionId(body)
    }
    func addSet(sessionId: Int, _ body: CreateSetBody) async throws {
        try await api.postSetIgnoringResponse(sessionId: sessionId, body)
    }
    func finishSession(sessionId: Int, _ body: FinishSessionBody) async throws {
        try await api.finishSessionIgnoringResponse(id: sessionId, body)
    }
    func putCalibration(exerciseId: Int, _ body: CalibrationPutBody) async throws {
        try await api.putCalibration(exerciseId: exerciseId, body)
    }
    func postMotionTrace(json: Data) async throws {
        try await api.postMotionTrace(json: json)
    }
    func isPermanentFailure(_ error: Error) -> Bool {
        (error as? APIError)?.isPermanent ?? false
    }
}

@MainActor
final class SyncService: ObservableObject {
    static let shared = SyncService()

    let outbox: Outbox
    /// Offline caches (workouts.json, settings.json).
    let cache = FileStore.applicationSupport("cache")

    @Published private(set) var pendingCount = 0
    @Published private(set) var deadLetterCount = 0
    @Published private(set) var lastError: String?
    @Published private(set) var lastSyncAt: Date?

    /// Serializes enqueues so ops land in the outbox in call order.
    private var tail: Task<Void, Never>?
    private var retryTask: Task<Void, Never>?

    private init() {
        outbox = Outbox(
            persistence: FileOutboxPersistence(store: .applicationSupport("outbox")),
            transport: APIOutboxTransport(api: .shared)
        )
        if let s = cache.load(ServerSettings.self, "settings.json") {
            AppSettings.shared.apply(s)
        }
        Task { await refreshCounts() }
    }

    // MARK: Outbox

    func enqueue(_ op: OutboxOp) {
        chain { outbox in await outbox.enqueue(op) }
    }

    func enqueueMotionTrace(_ body: MotionTraceBody) {
        chain { outbox in
            // Encoding thousands of samples: keep it off the main actor.
            let json = await Task.detached(priority: .utility) { try? JSONEncoder().encode(body) }.value
            if let json { await outbox.enqueueMotionTrace(json: json) }
        }
    }

    private func chain(_ work: @escaping @Sendable (Outbox) async -> Void) {
        let previous = tail
        let outbox = self.outbox
        tail = Task {
            await previous?.value
            await work(outbox)
            await outbox.resetBackoff()   // new data: try now even if we were backing off
            await self.flushNow()
        }
    }

    /// Deliver what we can now; schedules a retry if something is still pending.
    func flushNow() async {
        let report = await outbox.flush()
        if report.delivered > 0 { lastSyncAt = Date() }
        await refreshCounts()
        retryTask?.cancel()
        retryTask = nil
        if let retryAt = report.retryAt {
            let delay = max(1, retryAt - Date().timeIntervalSince1970)
            retryTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
                guard !Task.isCancelled else { return }
                await self?.flushNow()
            }
        }
    }

    /// App became active / user tapped "Sync now".
    func syncNow() async {
        await outbox.resetBackoff()
        await flushNow()
    }

    func requeueFailed() async {
        await outbox.requeueDeadLetters()
        await flushNow()
    }

    private func refreshCounts() async {
        pendingCount = await outbox.pendingCount
        let dead = await outbox.deadLetters
        deadLetterCount = dead.count
        lastError = dead.last.map { "\($0.label): \($0.error)" }
    }

    // MARK: Remote refresh (settings, calibration, workouts)

    /// Pull server state into the local caches. Each part fails independently (offline ok).
    func refreshRemote() async {
        let api = APIClient.shared
        if let s = try? await api.getSettings() {
            AppSettings.shared.apply(s)
            cache.save(s, "settings.json")
        }
        if let remote = try? await api.getCalibration() {
            CalibrationStore.shared.merge(remote: remote)
        }
        _ = try? await refreshWorkouts()
        await syncNow()
    }

    /// Fetches workouts and caches the raw JSON for offline starts.
    @discardableResult
    func refreshWorkouts() async throws -> [Workout] {
        let data = try await APIClient.shared.getWorkoutsData()
        let workouts = try JSONDecoder().decode([Workout].self, from: data)
        cache.write(data, "workouts.json")
        return workouts.filter { $0.archived != true }
    }

    func cachedWorkouts() -> [Workout]? {
        guard let data = cache.data("workouts.json"),
              let workouts = try? JSONDecoder().decode([Workout].self, from: data) else { return nil }
        return workouts.filter { $0.archived != true }
    }
}
