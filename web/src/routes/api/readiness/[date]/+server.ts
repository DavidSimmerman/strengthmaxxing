import { json, error } from '@sveltejs/kit';
import * as repo from '$lib/server/repo';
import type { RequestHandler } from './$types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(param: string): string {
	if (!DATE_RE.test(param)) throw error(400, 'date must be YYYY-MM-DD');
	return param;
}

// GET /api/readiness/:date → readiness row | null
export const GET: RequestHandler = ({ params }) => {
	const date = parseDate(params.date);
	try {
		const row = repo.getReadiness(date);
		return json(row ?? null);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to load readiness');
	}
};

// PUT /api/readiness/:date → upserts + computes score
export const PUT: RequestHandler = async ({ params, request }) => {
	const date = parseDate(params.date);

	let body: unknown = {};
	try {
		body = await request.json();
	} catch {
		body = {};
	}
	if (typeof body !== 'object' || body === null) throw error(400, 'body must be an object');
	const b = body as Record<string, unknown>;

	const input: {
		sleepHours?: number | null;
		kcalBalance?: number | null;
		proteinG?: number | null;
		sorenessNote?: string | null;
		sorenessLevel?: number | null;
		hrvMs?: number | null;
		hrvBaselineMs?: number | null;
		restingHr?: number | null;
		restingHrBaseline?: number | null;
	} = {
		sleepHours: numField(b.sleepHours, 'sleepHours'),
		kcalBalance: numField(b.kcalBalance, 'kcalBalance'),
		proteinG: numField(b.proteinG, 'proteinG'),
		sorenessNote: strField(b.sorenessNote, 'sorenessNote'),
		sorenessLevel: numField(b.sorenessLevel, 'sorenessLevel'),
		hrvMs: numField(b.hrvMs, 'hrvMs'),
		hrvBaselineMs: numField(b.hrvBaselineMs, 'hrvBaselineMs'),
		restingHr: numField(b.restingHr, 'restingHr'),
		restingHrBaseline: numField(b.restingHrBaseline, 'restingHrBaseline')
	};

	try {
		const row = repo.upsertReadiness(date, input);
		return json(row);
	} catch (e) {
		throw error(500, e instanceof Error ? e.message : 'failed to upsert readiness');
	}
};

function numField(v: unknown, field: string): number | null | undefined {
	if (v === undefined) return undefined;
	if (v === null) return null;
	if (typeof v !== 'number') throw error(400, `${field} must be a number`);
	return v;
}
function strField(v: unknown, field: string): string | null | undefined {
	if (v === undefined) return undefined;
	if (v === null) return null;
	if (typeof v !== 'string') throw error(400, `${field} must be a string`);
	return v;
}
