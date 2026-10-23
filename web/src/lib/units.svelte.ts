/**
 * Weight units. Storage and math are always kg; this converts at the display edge.
 * The current unit is app-wide state set by the root layout from the settings row,
 * so `wt()` re-renders everywhere when it changes.
 */
import { stepLb, nextLb } from './equipment';

export type Units = 'lb' | 'kg';
export const KG_PER_LB = 0.45359237;

const state = $state<{ units: Units }>({ units: 'lb' });
export const setUnits = (u: Units) => (state.units = u);
export const units = () => state.units;

/** kg → number in the user's unit, rounded for display (lb to 0.5, kg to 0.1). */
export function toDisplay(kgVal: number, u: Units = state.units): number {
	return u === 'lb' ? Math.round((kgVal / KG_PER_LB) * 2) / 2 : Math.round(kgVal * 10) / 10;
}

/** number in the user's unit → kg (unrounded, so 225 lb round-trips to exactly 225 lb). */
export function fromDisplay(v: number, u: Units = state.units): number {
	return u === 'lb' ? v * KG_PER_LB : v;
}

/** kg → "225 lb" / "102.5 kg". */
export function wt(kgVal: number | null | undefined, u: Units = state.units): string {
	if (kgVal == null) return '—';
	const v = toDisplay(kgVal, u);
	return `${Number.isInteger(v) ? v : v.toFixed(1)} ${u}`;
}

/** Big-number volume in the user's unit, "12,450 lb". */
export function vol(kgVal: number | null | undefined, u: Units = state.units): string {
	if (kgVal == null) return '—';
	return `${Math.round(u === 'lb' ? kgVal / KG_PER_LB : kgVal).toLocaleString('en-US')} ${u}`;
}

/** Stepper increment for an exercise category in the user's unit. */
export function weightStep(category: string, u: Units = state.units): number {
	if (u === 'lb') return stepLb(category);
	return category === 'dumbbell' ? 2 : category === 'bodyweight' ? 1 : 2.5;
}

/**
 * One +/− press on a weight, in the user's unit: lb walks the equipment's real settings (the
 * dumbbells jump 25 → 30), kg a plain grid. Off-grid values snap to the next setting.
 */
export function weightNext(category: string, v: number, dir: 1 | -1, u: Units = state.units): number {
	if (u === 'lb') return nextLb(category, v, dir);
	const s = weightStep(category, u);
	const k = v / s;
	const n = dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1;
	return Math.max(0, Math.round(n * s * 100) / 100);
}
