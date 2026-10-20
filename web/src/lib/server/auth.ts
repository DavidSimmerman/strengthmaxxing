/**
 * Single-user auth. One password (DASHBOARD_PASSWORD, falling back to API_TOKEN) unlocks the
 * dashboard via an HMAC-signed cookie; the watch/phone/agent use the bearer API_TOKEN.
 * Neither set → open (local dev).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const COOKIE = 'smx_session';
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

const password = () => env.DASHBOARD_PASSWORD || env.API_TOKEN || '';
export const authEnabled = () => password() !== '';

// The cookie value is a MAC of a fixed label keyed by the password, so changing the password
// signs everyone out and nothing needs storing server-side.
export const sessionToken = () => createHmac('sha256', password()).update('smx-dashboard-v1').digest('hex');

function safeEq(a: string, b: string) {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

export const checkPassword = (attempt: string) => authEnabled() && safeEq(attempt, password());
export const checkCookie = (value: string | undefined) => !!value && authEnabled() && safeEq(value, sessionToken());
export function checkBearer(header: string | null) {
	const token = env.API_TOKEN;
	return !!token && !!header && safeEq(header, `Bearer ${token}`);
}
