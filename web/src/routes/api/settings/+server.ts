import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/settings → {units, voiceCount, restAlarmSnoozeSec} (profile is coach-only)
export const GET: RequestHandler = () => {
	const { profile: _, ...s } = repo.getSettings();
	return json(s);
};

// PATCH /api/settings body any of {units, voiceCount, restAlarmSnoozeSec}
export const PATCH: RequestHandler = async ({ request }) => {
	let b: Record<string, unknown>;
	try {
		b = await request.json();
	} catch {
		throw error(400, 'invalid JSON body');
	}
	const patch: Partial<repo.AppSettings> = {};
	if (b.units !== undefined) {
		if (b.units !== 'lb' && b.units !== 'kg') throw error(400, 'units must be lb or kg');
		patch.units = b.units;
	}
	if (b.voiceCount !== undefined) {
		if (typeof b.voiceCount !== 'boolean') throw error(400, 'voiceCount must be a boolean');
		patch.voiceCount = b.voiceCount;
	}
	if (b.restAlarmSnoozeSec !== undefined) {
		const n = b.restAlarmSnoozeSec;
		if (typeof n !== 'number' || !Number.isInteger(n) || n < 10 || n > 600)
			throw error(400, 'restAlarmSnoozeSec must be an integer 10-600');
		patch.restAlarmSnoozeSec = n;
	}
	const { profile: _, ...s } = repo.patchSettings(patch);
	return json(s);
};
