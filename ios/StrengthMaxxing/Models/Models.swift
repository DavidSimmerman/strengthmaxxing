//
//  Models.swift
//  StrengthMaxxing (shared)
//
//  Codable models that mirror the strengthmaxxing web JSON API EXACTLY.
//  See API_CONTRACT.md at the repo root for the authoritative shapes.
//
//  Conventions from the contract:
//   - Weights are in kilograms (kg) everywhere.
//   - Server-generated timestamps are ISO-8601 strings (Drizzle `Date`).
//   - Client-supplied timestamps (startedAt, completedAt, rep offsetMs) are epoch milliseconds.
//

import Foundation

// MARK: - Exercise

/// `GET /api/exercises` → `Exercise[]`
struct Exercise: Codable, Identifiable, Hashable {
    let id: Int
    let name: String
    let muscle: String?
    let category: String?
    /// Metabolic equivalent used for kcal estimates on the server.
    let met: Double?
    let isBodyweight: Bool?
    let defaultRestSec: Int?
}

// MARK: - Workout templates

/// A single exercise slot inside a workout template.
///
/// The API returns each slot with a joined `.exercise` object (see contract:
/// "GET /api/workouts → Workout[] with nested exercises (each has `.exercise` joined)").
struct WorkoutExercise: Codable, Identifiable, Hashable {
    let id: Int?
    let workoutId: Int?
    let exerciseId: Int
    let orderIndex: Int
    /// Shared integer ⇒ these exercises form a superset. `nil` ⇒ standalone.
    let supersetGroup: Int?
    let targetSets: Int?
    let targetReps: Int?
    let targetWeightKg: Double?
    let restSec: Int?
    /// Joined exercise record (present on GET responses).
    let exercise: Exercise?
}

/// `GET /api/workouts` → `Workout[]`
struct Workout: Decodable, Identifiable, Hashable {
    let id: Int
    let name: String
    let notes: String?
    let archived: Bool?
    let createdAt: String?
    let updatedAt: String?
    let exercises: [WorkoutExercise]

    enum CodingKeys: String, CodingKey {
        case id, name, notes, archived, createdAt, updatedAt, exercises
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        archived = try c.decodeIfPresent(Bool.self, forKey: .archived)
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
        // `exercises` may be absent on some list endpoints; default to [].
        exercises = try c.decodeIfPresent([WorkoutExercise].self, forKey: .exercises) ?? []
    }
}

// MARK: - Bodies for creating / editing workout templates

/// Body element for `POST /api/workouts` / `PATCH /api/workouts/:id`.
struct WorkoutExerciseInput: Codable, Hashable {
    let exerciseId: Int
    let orderIndex: Int
    let supersetGroup: Int?
    let targetSets: Int?
    let targetReps: Int?
    let targetWeightKg: Double?
    let restSec: Int?
}

struct CreateWorkoutBody: Codable {
    let name: String
    let notes: String?
    let exercises: [WorkoutExerciseInput]
}

// MARK: - Sessions

/// `POST /api/sessions` body.
struct CreateSessionBody: Codable, Sendable {
    let workoutId: Int?
    let name: String?
    /// e.g. "ios", "watch". Free-form per contract.
    let source: String?
    let bodyweightKg: Double?
    let readinessScore: Int?
    /// v2: idempotency key (UUID string). Same clientId ⇒ server returns the existing session.
    var clientId: String? = nil
    /// v2: epoch ms — when the session really started (it may be posted later, offline).
    var startedAt: Int64? = nil
}

/// A single recorded rep event within a set.
///
/// `offsetMs` is milliseconds from the set's FIRST rep (so rep 0 is always 0).
struct RepEvent: Codable, Hashable, Sendable {
    let repIndex: Int
    let offsetMs: Int
    /// Optional concentric (lifting-phase) duration in ms if measured.
    let concentricMs: Int?

    init(repIndex: Int, offsetMs: Int, concentricMs: Int? = nil) {
        self.repIndex = repIndex
        self.offsetMs = offsetMs
        self.concentricMs = concentricMs
    }
}

/// `POST /api/sessions/:id/sets` body — this is what the watch posts per completed set.
///
/// Encoded by hand so optional fields go out as explicit `null` (contract: "clients send
/// `null` unless the user actually set it") rather than being omitted.
struct CreateSetBody: Codable, Sendable {
    let exerciseId: Int
    let setIndex: Int
    let supersetGroup: Int?
    /// Must be ≥ 1 — a 0-rep set is "skipped" and never posted.
    let reps: Int
    let weightKg: Double
    let rpe: Double?
    let isWarmup: Bool
    let restSecActual: Int?
    /// epoch ms
    let startedAt: Int64
    /// epoch ms
    let completedAt: Int64
    let repEvents: [RepEvent]
    /// v2: idempotency key (UUID string).
    var clientId: String? = nil

    enum CodingKeys: String, CodingKey {
        case exerciseId, setIndex, supersetGroup, reps, weightKg, rpe, isWarmup
        case restSecActual, startedAt, completedAt, repEvents, clientId
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(exerciseId, forKey: .exerciseId)
        try c.encode(setIndex, forKey: .setIndex)
        try c.encode(supersetGroup, forKey: .supersetGroup)   // Optional → null
        try c.encode(reps, forKey: .reps)
        try c.encode(weightKg, forKey: .weightKg)
        try c.encode(rpe, forKey: .rpe)                       // Optional → null
        try c.encode(isWarmup, forKey: .isWarmup)
        try c.encode(restSecActual, forKey: .restSecActual)   // Optional → null
        try c.encode(startedAt, forKey: .startedAt)
        try c.encode(completedAt, forKey: .completedAt)
        try c.encode(repEvents, forKey: .repEvents)
        try c.encodeIfPresent(clientId, forKey: .clientId)
    }
}

/// `PATCH /api/sessions/:id/sets/:setId` body (any subset).
struct UpdateSetBody: Codable, Sendable {
    var reps: Int? = nil
    var weightKg: Double? = nil
    var rpe: Double? = nil
    var isWarmup: Bool? = nil
}

/// A recorded set as returned within a session (`GET /api/sessions/:id`).
///
/// Contract note: it says each set has "`.exercise`, `.reps`". Here `reps` is the integer
/// rep COUNT of the set (as in the POST body). The joined per-rep event rows may be
/// serialized under `repEvents` OR `reps` (as an array) depending on the ORM relation name;
/// we decode `repEvents` defensively and tolerate its absence.
struct WorkoutSet: Decodable, Identifiable, Hashable {
    let id: Int
    let sessionId: Int?
    let exerciseId: Int
    let setIndex: Int?
    let supersetGroup: Int?
    /// Integer rep count for the set.
    let reps: Int
    let weightKg: Double
    let rpe: Double?
    let isWarmup: Bool?
    let restSecActual: Int?
    /// ISO-8601 strings — the server stores these as Dates and JSON-serializes
    /// them as strings (epoch ms is only used in the POST body direction).
    let startedAt: String?
    let completedAt: String?
    /// Joined exercise (var so a PATCH response without the join can keep it).
    var exercise: Exercise?
    /// Joined per-rep timing events, if present.
    let repEvents: [RepEvent]?

    enum CodingKeys: String, CodingKey {
        case id, sessionId, exerciseId, setIndex, supersetGroup, reps, weightKg
        case rpe, isWarmup, restSecActual, startedAt, completedAt, exercise, repEvents
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        sessionId = try c.decodeIfPresent(Int.self, forKey: .sessionId)
        exerciseId = try c.decode(Int.self, forKey: .exerciseId)
        setIndex = try c.decodeIfPresent(Int.self, forKey: .setIndex)
        supersetGroup = try c.decodeIfPresent(Int.self, forKey: .supersetGroup)
        weightKg = try c.decodeIfPresent(Double.self, forKey: .weightKg) ?? 0
        rpe = try c.decodeIfPresent(Double.self, forKey: .rpe)
        isWarmup = try c.decodeIfPresent(Bool.self, forKey: .isWarmup)
        restSecActual = try c.decodeIfPresent(Int.self, forKey: .restSecActual)
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt)
        completedAt = try c.decodeIfPresent(String.self, forKey: .completedAt)
        exercise = try c.decodeIfPresent(Exercise.self, forKey: .exercise)

        // `reps` may be an Int (the count) or, in some serializations, an array of rep
        // events. Handle both: prefer the explicit `repEvents` array for timing.
        if let count = try? c.decode(Int.self, forKey: .reps) {
            reps = count
            repEvents = try c.decodeIfPresent([RepEvent].self, forKey: .repEvents)
        } else if let events = try? c.decode([RepEvent].self, forKey: .reps) {
            reps = events.count
            repEvents = events
        } else {
            reps = 0
            repEvents = try c.decodeIfPresent([RepEvent].self, forKey: .repEvents)
        }
    }
}

/// `POST /api/sessions` (created), `GET /api/sessions/:id` (with nested sets),
/// and `GET /api/sessions?limit=` (summaries).
struct Session: Decodable, Identifiable, Hashable {
    let id: Int
    let workoutId: Int?
    let name: String?
    let source: String?
    let bodyweightKg: Double?
    let readinessScore: Int?
    /// ISO strings from the server. The end-of-session column is `endedAt`.
    let startedAt: String?
    let endedAt: String?
    /// Computed on finish.
    let totalVolumeKg: Double?
    let estimatedKcal: Double?
    let notes: String?
    let sets: [WorkoutSet]?

    enum CodingKeys: String, CodingKey {
        case id, workoutId, name, source, bodyweightKg, readinessScore
        case startedAt, endedAt, totalVolumeKg, estimatedKcal, notes, sets
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(Int.self, forKey: .id)
        workoutId = try c.decodeIfPresent(Int.self, forKey: .workoutId)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        source = try c.decodeIfPresent(String.self, forKey: .source)
        bodyweightKg = try c.decodeIfPresent(Double.self, forKey: .bodyweightKg)
        readinessScore = try c.decodeIfPresent(Int.self, forKey: .readinessScore)
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt)
        endedAt = try c.decodeIfPresent(String.self, forKey: .endedAt)
        totalVolumeKg = try c.decodeIfPresent(Double.self, forKey: .totalVolumeKg)
        estimatedKcal = try c.decodeIfPresent(Double.self, forKey: .estimatedKcal)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        sets = try c.decodeIfPresent([WorkoutSet].self, forKey: .sets)
    }
}

/// `POST /api/sessions/:id/finish` body.
struct FinishSessionBody: Codable, Sendable {
    let notes: String?
    let bodyweightKg: Double?
}

// MARK: - Settings (v2)

/// `GET /api/settings` — shared by dashboard, phone and watch. Missing keys → defaults.
struct ServerSettings: Codable, Equatable, Sendable {
    var units: WeightUnit = .lb
    var voiceCount: Bool = true
    var restAlarmSnoozeSec: Int = 60

    init(units: WeightUnit = .lb, voiceCount: Bool = true, restAlarmSnoozeSec: Int = 60) {
        self.units = units
        self.voiceCount = voiceCount
        self.restAlarmSnoozeSec = restAlarmSnoozeSec
    }

    enum CodingKeys: String, CodingKey { case units, voiceCount, restAlarmSnoozeSec }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        units = (try? c.decodeIfPresent(WeightUnit.self, forKey: .units)) ?? .lb
        voiceCount = (try? c.decodeIfPresent(Bool.self, forKey: .voiceCount)) ?? true
        restAlarmSnoozeSec = (try? c.decodeIfPresent(Int.self, forKey: .restAlarmSnoozeSec)) ?? 60
    }
}

// MARK: - Motion traces (v2)

/// `POST /api/motion-traces` body. `samples` rows are
/// `[tMs, ax, ay, az, gx, gy, gz, rx, ry, rz]` with tMs relative to the first sample.
struct MotionTraceBody: Codable, Sendable {
    let exerciseId: Int
    let setClientId: String?
    let sampleHz: Double
    let detectedReps: Int
    let actualReps: Int
    let params: RepCounterParams?
    let samples: [[Double]]

    /// Builds the body, rounding values (4 dp, ms for time) to keep it well under 4 MB.
    init(exerciseId: Int, setClientId: String?, sampleHz: Double, detectedReps: Int,
         actualReps: Int, params: RepCounterParams?, motion: [MotionSample]) {
        self.exerciseId = exerciseId
        self.setClientId = setClientId
        self.sampleHz = sampleHz
        self.detectedReps = detectedReps
        self.actualReps = actualReps
        self.params = params
        let t0 = motion.first?.t ?? 0
        func r(_ v: Double) -> Double { (v * 10_000).rounded() / 10_000 }
        self.samples = motion.map { m in
            [((m.t - t0) * 1000).rounded(), r(m.ax), r(m.ay), r(m.az), r(m.gx), r(m.gy), r(m.gz),
             r(m.rx), r(m.ry), r(m.rz)]
        }
    }
}

// MARK: - HealthKit payload

/// `GET /api/sessions/:id/healthkit` → HKWorkout payload (`repo.healthkitPayload`).
/// Shape verified against the server: `workoutActivityType`, ISO `start`/`end`,
/// `durationSec`, `totalEnergyBurnedKcal`. All optional so we can fall back to
/// building the HKWorkout locally from the finished session if any are missing.
struct HealthKitPayload: Decodable {
    let workoutActivityType: String?
    /// ISO-8601 strings
    let start: String?
    let end: String?
    let durationSec: Double?
    let totalEnergyBurnedKcal: Double?
    // ponytail: server metadata mixes string/number values — omitted until a consumer needs it
}

// MARK: - API error envelope

/// The web API (SvelteKit) serializes errors as `{ "message": string }`; the
/// internal coach agent service uses `{ "error": string }`. Tolerate both.
struct APIErrorBody: Decodable {
    let message: String?
    let error: String?
}
