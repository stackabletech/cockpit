import { json, redirect } from '@sveltejs/kit';

/**
 * Build the response for a request that requires authentication but has no
 * valid session.
 *
 * API routes get a JSON 401 so that client-side `fetch` callers receive a
 * parseable error.
 * The client treats a 401 as a hint to re-check the session (see
 * `src/hooks.client.ts`). All other routes redirect to the login page.
 */
export function unauthenticatedResponse(url: URL): Response {
  if (url.pathname.startsWith('/api/')) {
    return json({ message: 'Authentication required' }, { status: 401 });
  }
  const redirectTo = encodeURIComponent(url.pathname + url.search);
  throw redirect(302, `/auth/login?redirectTo=${redirectTo}`);
}
