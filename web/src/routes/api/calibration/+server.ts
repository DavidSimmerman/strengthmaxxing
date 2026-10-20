import { json } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

// GET /api/calibration → [{exerciseId, params, samples, updatedAt}]
export const GET: RequestHandler = () => json(repo.listCalibration());
