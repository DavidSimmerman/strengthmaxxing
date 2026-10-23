/**
 * The weights David's equipment can actually be set to, in lb (mirrored in
 * ios/StrengthMaxxing/Core/Units.swift). Steppers, the mid-workout weight drop and the coach's
 * rounding all move along these.
 *
 * - Dumbbells: Bowflex SelectTech 552, per hand: 5–25 in 2.5 lb steps, then 30–50 in 5, then 52.5.
 * - Cable stack: 2.5 lb steps.
 * - Barbell / Smith / machine: 5 lb steps.
 */
const DUMBBELL_LB = [5, 7.5, 10, 12.5, 15, 17.5, 20, 22.5, 25, 30, 35, 40, 45, 50, 52.5];

export function stepLb(category: string): number {
	return category === 'cable' || category === 'bodyweight' || category === 'kettlebell' ? 2.5 : 5;
}

/** Every settable weight at or below `max` lb (a fixed list for dumbbells, a grid otherwise). */
function ladder(category: string, around: number): number[] {
	if (category === 'dumbbell') return DUMBBELL_LB;
	const s = stepLb(category);
	const top = Math.ceil((around + 10 * s) / s);
	return Array.from({ length: top + 1 }, (_, i) => i * s);
}

/** The next settable weight above (dir 1) or below (dir -1) `v` lb. Off-ladder values snap. */
export function nextLb(category: string, v: number, dir: 1 | -1): number {
	const l = ladder(category, v);
	if (dir > 0) return l.find((x) => x > v + 1e-6) ?? (category === 'dumbbell' ? l.at(-1)! : v + stepLb(category));
	return [...l].reverse().find((x) => x < v - 1e-6) ?? 0;
}

/** Settable weights below `v` lb, nearest first. */
export function belowLb(category: string, v: number): number[] {
	return ladder(category, v)
		.filter((x) => x < v - 1e-6 && x > 0)
		.reverse();
}

/** For the coach prompt: how to round weights to this equipment. */
export const EQUIPMENT_ROUNDING =
	'Round every weight to what the equipment can be set to (in lb): barbell, Smith and machines in ' +
	'5 lb steps; cable stack in 2.5 lb steps; dumbbells are Bowflex SelectTech 552 (per hand 5-25 lb ' +
	'in 2.5 lb steps, then 30, 35, 40, 45, 50, 52.5; nothing heavier).';
