import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { error, redirect, type Handle } from '@sveltejs/kit';
import { db } from '$lib/db';
import { seedExercises } from '$lib/db/seed';
import { COOKIE, authEnabled, checkBearer, checkCookie } from '$lib/server/auth';

// Run once at server startup: apply migrations, then seed the exercise library.
try {
	migrate(db, { migrationsFolder: './drizzle' });
	seedExercises();
} catch (e) {
	console.error('[boot] migrate/seed failed:', e);
}

const PUBLIC = ['/login', '/healthz'];

/**
 * Auth, when a password is configured (see $lib/server/auth):
 * - `/api/*` accepts the bearer API_TOKEN (watch, phone, agent) OR the dashboard cookie, so the
 *   dashboard's own fetches to /api (coach page) work.
 * - Every dashboard page needs the cookie; otherwise → /login.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;
	const authed = () =>
		!authEnabled() ||
		checkCookie(event.cookies.get(COOKIE)) ||
		checkBearer(event.request.headers.get('authorization'));

	if (pathname.startsWith('/api/')) {
		// CORS preflight must NOT require auth (browsers send OPTIONS without the header).
		if (event.request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'access-control-allow-origin': '*',
					'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
					'access-control-allow-headers': 'authorization,content-type'
				}
			});
		}
		if (!authed()) throw error(401, 'unauthorized');
		const res = await resolve(event);
		res.headers.set('access-control-allow-origin', '*');
		return res;
	}

	if (!PUBLIC.includes(pathname) && !authed()) {
		throw redirect(303, `/login?next=${encodeURIComponent(pathname + event.url.search)}`);
	}
	return resolve(event);
};
