import { json, error } from '@sveltejs/kit';
import { planToday, isMuscle } from '$lib/server/today';
import type { Soreness } from '$lib/coach/engine';
import type { RequestHandler } from './$types';

// POST /api/coach/today body {energy?:1-5, minutes:number, soreness?:{[muscle]:0|1|2}}
// → today's generated session (engine only; no Claude call, instant).
export const POST: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	if (typeof b !== 'object' || b === null) throw error(400, 'body must be an object');
	if (typeof b.minutes !== 'number' || b.minutes < 10 || b.minutes > 240) throw error(400, 'minutes must be 10-240');
	if (b.energy != null && (typeof b.energy !== 'number' || b.energy < 1 || b.energy > 5)) throw error(400, 'energy must be 1-5');
	const soreness: Soreness = {};
	for (const [k, v] of Object.entries((b.soreness ?? {}) as Record<string, unknown>)) {
		if (!isMuscle(k)) throw error(400, `unknown muscle "${k}"`);
		if (v !== 0 && v !== 1 && v !== 2) throw error(400, `soreness.${k} must be 0, 1 or 2`);
		soreness[k] = v;
	}
	return json(planToday({ energy: b.energy ?? null, minutes: b.minutes, soreness }));
};
