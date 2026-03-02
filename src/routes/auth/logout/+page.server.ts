import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';

export const load: PageServerLoad = async ({ request, locals, cookies }) => {
  if (locals.session) {
    await auth.api.signOut({ headers: request.headers });
    cookies.delete('better-auth.session_token', { path: '/' });
  }
  throw redirect(302, '/auth/login');
};
