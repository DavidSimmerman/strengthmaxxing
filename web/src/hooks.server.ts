import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { error, type Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { seedExercises } from '$lib/db/seed';

// Run once at server startup: apply migrations, then seed the exercise library.
try {
	migrate(db, { migrationsFolder: './drizzle' });
	seedExercises();
} catch (e) {
	console.error('[boot] migrate/seed failed:', e);
}

/**
 * Guard the external JSON API (`/api/*`) with a bearer token when API_TOKEN is set.
 * The watch, iOS app and coach agent send it. The web dashboard uses server load
 * functions (direct DB), so it never hits these routes and needs no token.
 */
export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/')) {
		// CORS preflight must NOT require auth (browsers send OPTIONS without the header).
		if (event.request.method === 'OPTIONS') {
			return new Response(null, {
				headers: {
					'access-control-allow-origin': '*',
					'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
					'access-control-allow-headers': 'authorization,content-type'
				}
			});
		}
		const token = env.API_TOKEN;
		if (token) {
			const auth = event.request.headers.get('authorization') ?? '';
			if (auth !== `Bearer ${token}`) throw error(401, 'unauthorized');
		}
		const res = await resolve(event);
		res.headers.set('access-control-allow-origin', '*');
		return res;
	}
	return resolve(event);
};
