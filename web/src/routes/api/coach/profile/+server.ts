import { json, error } from '@sveltejs/kit';
import * as coach from '$lib/server/coach';
import type { RequestHandler } from './$types';

// GET /api/coach/profile → {profile, activeProgram, week}
export const GET: RequestHandler = () => {
	const p = coach.getActiveProgram();
	return json({ profile: coach.getProfile(), activeProgram: p, week: p ? coach.programWeek(p) : null });
};

// PUT /api/coach/profile body CoachProfile → saved profile
export const PUT: RequestHandler = async ({ request }) => {
	const b = await request.json().catch(() => null);
	if (typeof b !== 'object' || b === null || Array.isArray(b)) throw error(400, 'profile object required');
	const d = (b as coach.CoachProfile).daysPerWeek;
	if (d !== undefined && (!Number.isInteger(d) || d < 1 || d > 7)) throw error(400, 'daysPerWeek must be 1-7');
	coach.saveProfile(b as coach.CoachProfile);
	return json(coach.getProfile());
};
