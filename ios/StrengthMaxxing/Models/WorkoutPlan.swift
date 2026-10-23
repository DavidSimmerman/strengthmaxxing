//
//  WorkoutPlan.swift
//  StrengthMaxxing (shared)
//
//  Superset-aware expansion of a workout template into an ordered list of performable
//  "slots" (one set each). SHARED by both the iPhone and the watch so they walk a workout
//  identically.
//
//  Superset rules (per API_CONTRACT.md):
//   - Exercises sharing a `supersetGroup` are cycled with NO rest between members.
//   - Rest runs only AFTER the last exercise in the group (per round).
//
//  One-side-at-a-time exercises (`perSide`): each set is two slots, the side wearing the watch
//  first (it can count reps), then the other side, with no rest between the two.
//

import Foundation

/// One performable set derived from a workout template.
struct WorkoutSlot: Identifiable, Hashable {
    let id = UUID()
    let workoutExercise: WorkoutExercise
    /// Set number within this exercise (0-based).
    let setIndex: Int
    /// Does rest follow this slot? (false when a superset partner comes next).
    let restAfter: Bool
    /// Rest seconds to use after this slot.
    let restSec: Int
    /// "L" / "R" for one-side-at-a-time exercises; nil = both sides together.
    var side: String? = nil

    var exercise: Exercise? { workoutExercise.exercise }
    var exerciseId: Int { workoutExercise.exerciseId }
    var supersetGroup: Int? { workoutExercise.supersetGroup }
    var targetReps: Int? { workoutExercise.targetReps }
    var targetWeightKg: Double? { workoutExercise.targetWeightKg }
}

enum WorkoutPlanner {
    /// Expand a workout template into an ordered slot list.
    /// `watchSide`: the arm wearing the watch ("L" / "R"), done first on one-side exercises.
    static func buildSlots(from workout: Workout, watchSide: String = "L") -> [WorkoutSlot] {
        let otherSide = watchSide == "L" ? "R" : "L"
        let ordered = workout.exercises.sorted { $0.orderIndex < $1.orderIndex }
        var slots: [WorkoutSlot] = []

        var i = 0
        while i < ordered.count {
            let we = ordered[i]
            if let group = we.supersetGroup {
                // Collect the contiguous run of members in this group.
                var members: [WorkoutExercise] = []
                var j = i
                while j < ordered.count, ordered[j].supersetGroup == group {
                    members.append(ordered[j]); j += 1
                }
                let rounds = members.map { $0.targetSets ?? 1 }.max() ?? 1
                for r in 0..<rounds {
                    // Which members still have a set to do this round?
                    let active = members.filter { r < ($0.targetSets ?? 1) }
                    for (idx, m) in active.enumerated() {
                        let isLast = (idx == active.count - 1)
                        slots.append(WorkoutSlot(
                            workoutExercise: m,
                            setIndex: r,
                            restAfter: isLast,
                            restSec: restValue(for: members.last ?? m)
                        ))
                    }
                }
                i = j
            } else {
                let sets = we.targetSets ?? 1
                for r in 0..<sets {
                    if we.perSide == true {
                        slots.append(WorkoutSlot(workoutExercise: we, setIndex: r, restAfter: false,
                                                 restSec: 0, side: watchSide))
                        slots.append(WorkoutSlot(workoutExercise: we, setIndex: r, restAfter: true,
                                                 restSec: restValue(for: we), side: otherSide))
                    } else {
                        slots.append(WorkoutSlot(
                            workoutExercise: we,
                            setIndex: r,
                            restAfter: true,
                            restSec: restValue(for: we)
                        ))
                    }
                }
                i += 1
            }
        }
        return slots
    }

    static func restValue(for we: WorkoutExercise) -> Int {
        we.restSec ?? we.exercise?.defaultRestSec ?? 90
    }
}
