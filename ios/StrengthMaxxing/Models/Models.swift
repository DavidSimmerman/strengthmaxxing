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
struct CreateSessionBody: Codable {
    let workoutId: Int?
    let name: String?
    /// e.g. "ios", "watch". Free-form per contract.
    let source: String?
    let bodyweightKg: Double?
    let readinessScore: Int?
}

/// A single recorded rep event within a set.
///
/// `offsetMs` is milliseconds from the set's FIRST rep (so rep 0 is always 0).
struct RepEvent: Codable, Hashable {
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
struct CreateSetBody: Codable {
    let exerciseId: Int
    let setIndex: Int
    let supersetGroup: Int?
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
    let startedAt: Int64?
    let completedAt: Int64?
    /// Joined exercise.
    let exercise: Exercise?
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
        startedAt = try c.decodeIfPresent(Int64.self, forKey: .startedAt)
        completedAt = try c.decodeIfPresent(Int64.self, forKey: .completedAt)
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
    /// ISO strings from the server.
    let startedAt: String?
    let completedAt: String?
    /// Computed on finish.
    let totalVolumeKg: Double?
    let estimatedKcal: Double?
    let notes: String?
    let sets: [WorkoutSet]?

    enum CodingKeys: String, CodingKey {
        case id, workoutId, name, source, bodyweightKg, readinessScore
        case startedAt, completedAt, totalVolumeKg, estimatedKcal, notes, sets
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
        completedAt = try c.decodeIfPresent(String.self, forKey: .completedAt)
        totalVolumeKg = try c.decodeIfPresent(Double.self, forKey: .totalVolumeKg)
        estimatedKcal = try c.decodeIfPresent(Double.self, forKey: .estimatedKcal)
        notes = try c.decodeIfPresent(String.self, forKey: .notes)
        sets = try c.decodeIfPresent([WorkoutSet].self, forKey: .sets)
    }
}

/// `POST /api/sessions/:id/finish` body.
struct FinishSessionBody: Codable {
    let notes: String?
    let bodyweightKg: Double?
}

// MARK: - HealthKit payload

/// `GET /api/sessions/:id/healthkit` → HKWorkout payload (`repo.healthkitPayload`).
///
/// The exact fields the server emits are not fully specified in the contract, so we
/// decode defensively: the fields we rely on are optional and we fall back to
/// building the HKWorkout locally from the finished session if any are missing.
struct HealthKitPayload: Codable {
    let activityType: String?
    /// epoch ms
    let startDate: Int64?
    /// epoch ms
    let endDate: Int64?
    let totalEnergyBurnedKcal: Double?
    let totalDistanceMeters: Double?
    let metadata: [String: String]?
}

// MARK: - API error envelope

/// Every endpoint returns `{ "error": string }` on failure (contract).
struct APIErrorBody: Codable {
    let error: String
}
