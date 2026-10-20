import { fail, redirect } from '@sveltejs/kit';
import { COOKIE, COOKIE_MAX_AGE, authEnabled, checkPassword, sessionToken } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

// Only allow same-site relative redirects after login.
const safeNext = (n: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

export const load: PageServerLoad = ({ url }) => {
	if (!authEnabled()) throw redirect(303, safeNext(url.searchParams.get('next')));
	return {};
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const fd = await request.formData();
		if (!checkPassword(String(fd.get('password') ?? ''))) return fail(401, { error: 'Wrong password' });
		cookies.set(COOKIE, sessionToken(), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: COOKIE_MAX_AGE
		});
		throw redirect(303, safeNext(url.searchParams.get('next')));
	}
};
