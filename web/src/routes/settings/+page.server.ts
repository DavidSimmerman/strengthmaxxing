import { fail } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import { authEnabled } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = () => ({
	settings: repo.getSettings(),
	custom: repo.listExercises().filter((e) => e.isCustom),
	authEnabled: authEnabled()
});

export const actions: Actions = {
	save: async ({ request }) => {
		const fd = await request.formData();
		const snooze = Number(fd.get('restAlarmSnoozeSec'));
		if (!Number.isInteger(snooze) || snooze < 10 || snooze > 600)
			return fail(400, { error: 'Snooze must be 10–600 seconds' });
		repo.patchSettings({
			units: fd.get('units') === 'kg' ? 'kg' : 'lb',
			voiceCount: fd.get('voiceCount') === 'on',
			restAlarmSnoozeSec: snooze
		});
		return { saved: true };
	},
	addExercise: async ({ request }) => {
		const fd = await request.formData();
		const name = String(fd.get('name') ?? '').trim();
		const muscle = String(fd.get('muscle') ?? '').trim().toLowerCase();
		const category = String(fd.get('category') ?? 'barbell');
		if (!name || !muscle) return fail(400, { exError: 'Name and muscle are required' });
		try {
			repo.createExercise({ name, muscle, category });
		} catch (e) {
			if (repo.isUniqueError(e)) return fail(409, { exError: `"${name}" already exists` });
			throw e;
		}
		return { added: name };
	}
};
