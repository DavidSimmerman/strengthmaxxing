import * as repo from '$lib/server/repo';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const sessions = repo.listSessions(50).filter((s) => s.endedAt != null);
	return {
		sessions: sessions.map((s) => ({
			id: s.id,
			name: s.name,
			startedAt: s.startedAt,
			endedAt: s.endedAt,
			durationMs:
				s.endedAt && s.startedAt ? s.endedAt.getTime() - s.startedAt.getTime() : null,
			totalVolumeKg: s.totalVolumeKg,
			estimatedKcal: s.estimatedKcal,
			readinessScore: s.readinessScore
		}))
	};
};
