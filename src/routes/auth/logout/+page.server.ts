import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { auth, oidcEndSessionEndpoint } from '$lib/server/auth';

export const load: PageServerLoad = async ({ request, locals, cookies }) => {
  if (locals.session) {
    await auth.api.signOut({ headers: request.headers });
    cookies.delete('better-auth.session_token', { path: '/' });
  }

  // RP-initiated logout: redirect to the IdP so the SSO session is terminated
  if (oidcEndSessionEndpoint) {
    const url = new URL(oidcEndSessionEndpoint);
    url.searchParams.set('post_logout_redirect_uri', `${env.STACKABLE_UI_BASE_URL}/auth/login`);
    throw redirect(302, url.toString());
  }

  throw redirect(302, '/auth/login');
};
