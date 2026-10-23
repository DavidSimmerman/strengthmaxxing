/**
 * How long a set takes, so rest can be measured from the phone (which only knows when "Log set"
 * was tapped): rest before a set = its estimated start − the previous set's finish.
 *
 * Seconds per rep at a normal controlled tempo (~1 s up, ~2 s down) plus setup time
 * (unrack, brace, grab the handle). Coaching estimates; per exercise, the watch's measured
 * rep timing replaces the per-rep number once there is some (see repo.secPerRep).
 */
const TEMPO: Record<string, { perRep: number; setup: number }> = {
	barbell: { perRep: 3.5, setup: 20 },
	smith: { perRep: 3.5, setup: 15 },
	dumbbell: { perRep: 3, setup: 10 },
	machine: { perRep: 3, setup: 10 },
	cable: { perRep: 2.5, setup: 5 },
	bodyweight: { perRep: 2, setup: 5 }
};

export function setupSec(category: string) {
	return (TEMPO[category] ?? TEMPO.machine).setup;
}

/** Estimated working time of one set in seconds. `perRep` overrides the category default. */
export function estimateSetSec(category: string, reps: number, perRep?: number | null) {
	const t = TEMPO[category] ?? TEMPO.machine;
	return Math.round(Math.max(1, reps) * (perRep ?? t.perRep) + t.setup);
}

/** A gap longer than this between sets isn't rest (left the gym, phone forgotten). */
export const MAX_REST_SEC = 15 * 60;

/** Seconds to swap sides on a one-arm / one-leg exercise. */
export const SWITCH_SEC = 5;
