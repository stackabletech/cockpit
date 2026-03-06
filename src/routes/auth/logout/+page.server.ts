import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { auth, oidcEnabled } from '$lib/server/auth';

export const load: PageServerLoad = async ({ request, locals, cookies }) => {
  if (locals.session) {
    await auth.api.signOut({ headers: request.headers });
    cookies.delete('better-auth.session_token', { path: '/' });
  }

  // Local-only logout: we intentionally do not call the IdP's end_session_endpoint
  // because RP-initiated logout would terminate the user's entire SSO session,
  // logging them out of all applications — not just this one.
  throw redirect(302, oidcEnabled ? '/auth/login' : '/');
};
