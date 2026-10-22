import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

// GET /api/device-credentials → {token, baseURL} for the iPhone app to hand to the watch.
// Reaching this already requires the dashboard sign-in (or the token itself), see hooks.server.ts.
export const GET: RequestHandler = ({ url }) => {
	if (!env.API_TOKEN) throw error(404, 'API_TOKEN is not set on the server');
	return json({ token: env.API_TOKEN, baseURL: env.ORIGIN || url.origin });
};
