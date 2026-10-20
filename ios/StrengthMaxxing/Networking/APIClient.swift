//
//  APIClient.swift
//  StrengthMaxxing (shared)
//
//  Thin async/await URLSession wrapper over the strengthmaxxing JSON API.
//  Base URL + bearer token come from AppSettings. Both the iOS app and the watch
//  app use this client directly (the watch talks to the API without a phone relay).
//

import Foundation

enum APIError: LocalizedError {
    case notConfigured
    case invalidURL
    case http(status: Int, message: String)
    case decoding(Error)
    case transport(Error)

    var errorDescription: String? {
        switch self {
        case .notConfigured:
            return "Server URL is not set. Open Settings and enter your server address."
        case .invalidURL:
            return "The server URL is invalid."
        case let .http(status, message):
            return "Server error \(status): \(message)"
        case let .decoding(error):
            return "Could not read the server response: \(error.localizedDescription)"
        case let .transport(error):
            return error.localizedDescription
        }
    }
}

/// Non-isolated networking client. `URLSession` is thread-safe and each request is
/// independent, so we don't need actor isolation here. Config (base URL + token) is
/// snapshotted from `AppSettings` on the main actor for each request, so no mutable UI
/// state ever crosses concurrency domains.
final class APIClient: Sendable {
    static let shared = APIClient()

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder
    /// How to obtain the current config. Defaults to reading the shared AppSettings on the
    /// main actor; injectable for tests.
    private let configProvider: @Sendable () async -> APIConfig

    init(
        session: URLSession = .shared,
        configProvider: @escaping @Sendable () async -> APIConfig = { await AppSettings.shared.apiConfig }
    ) {
        self.session = session
        self.decoder = JSONDecoder()
        self.encoder = JSONEncoder()
        self.configProvider = configProvider
    }

    // MARK: Request building

    private func makeURL(_ base: URL, _ path: String, query: [URLQueryItem]) throws -> URL {
        guard var comps = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL
        }
        // Append path onto whatever base path the user gave us.
        var basePath = comps.path
        if basePath.hasSuffix("/") { basePath.removeLast() }
        comps.path = basePath + path
        if !query.isEmpty { comps.queryItems = query }
        guard let url = comps.url else { throw APIError.invalidURL }
        return url
    }

    private func request(
        _ method: String,
        _ path: String,
        query: [URLQueryItem] = [],
        body: Data? = nil
    ) async throws -> URLRequest {
        let config = await configProvider()
        guard let base = config.baseURL else { throw APIError.notConfigured }
        var req = URLRequest(url: try makeURL(base, path, query: query))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if body != nil {
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.httpBody = body
        }
        // Auth header is only required when the server has API_TOKEN set, but always
        // sending it (when we have one) is harmless.
        if !config.token.isEmpty {
            req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        }
        req.timeoutInterval = 30
        return req
    }

    // MARK: Core send

    private func send<T: Decodable>(_ req: URLRequest, as type: T.Type) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw APIError.transport(error)
        }
        guard let http = response as? HTTPURLResponse else {
            throw APIError.http(status: -1, message: "No HTTP response")
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? decoder.decode(APIErrorBody.self, from: data)
            let message = body?.message ?? body?.error
                ?? String(data: data, encoding: .utf8)
                ?? "Unknown error"
            throw APIError.http(status: http.statusCode, message: message)
        }
        if T.self == EmptyResponse.self {
            return EmptyResponse() as! T
        }
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    private func encode<B: Encodable>(_ body: B) throws -> Data {
        do { return try encoder.encode(body) }
        catch { throw APIError.decoding(error) }
    }

    // MARK: - Endpoints

    // Exercises
    func getExercises() async throws -> [Exercise] {
        try await send(try await request("GET", "/api/exercises"), as: [Exercise].self)
    }

    // Workouts
    func getWorkouts() async throws -> [Workout] {
        try await send(try await request("GET", "/api/workouts"), as: [Workout].self)
    }

    func getWorkout(id: Int) async throws -> Workout {
        try await send(try await request("GET", "/api/workouts/\(id)"), as: Workout.self)
    }

    func createWorkout(_ body: CreateWorkoutBody) async throws -> Workout {
        try await send(try await request("POST", "/api/workouts", body: encode(body)), as: Workout.self)
    }

    // Sessions
    func getSessions(limit: Int = 30) async throws -> [Session] {
        let q = [URLQueryItem(name: "limit", value: String(limit))]
        return try await send(try await request("GET", "/api/sessions", query: q), as: [Session].self)
    }

    func getSession(id: Int) async throws -> Session {
        try await send(try await request("GET", "/api/sessions/\(id)"), as: Session.self)
    }

    func startSession(_ body: CreateSessionBody) async throws -> Session {
        try await send(try await request("POST", "/api/sessions", body: encode(body)), as: Session.self)
    }

    /// Posts one completed set (used heavily by the watch).
    @discardableResult
    func postSet(sessionId: Int, _ body: CreateSetBody) async throws -> WorkoutSet {
        try await send(
            try await request("POST", "/api/sessions/\(sessionId)/sets", body: encode(body)),
            as: WorkoutSet.self
        )
    }

    /// Finalizes a session; response carries totalVolumeKg + estimatedKcal for HealthKit.
    func finishSession(id: Int, _ body: FinishSessionBody) async throws -> Session {
        try await send(
            try await request("POST", "/api/sessions/\(id)/finish", body: encode(body)),
            as: Session.self
        )
    }

    func deleteSession(id: Int) async throws {
        _ = try await send(try await request("DELETE", "/api/sessions/\(id)"), as: EmptyResponse.self)
    }

    /// Optional: server-built HealthKit payload. We tolerate its absence.
    func getHealthKitPayload(sessionId: Int) async throws -> HealthKitPayload {
        try await send(
            try await request("GET", "/api/sessions/\(sessionId)/healthkit"),
            as: HealthKitPayload.self
        )
    }

    /// Lightweight connectivity check for Settings.
    func ping() async throws -> Int {
        _ = try await getExercises()
        return 200
    }
}

/// Sentinel for endpoints with no meaningful body (e.g. DELETE).
struct EmptyResponse: Decodable {}
