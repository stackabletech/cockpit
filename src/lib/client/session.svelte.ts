import { authClient } from '$lib/auth-client';

/**
 * Client-side view of the user's session. `active` is set while a signed-in
 * layout is mounted; without it (e.g. OIDC disabled) no checks are made.
 */
export const sessionState = $state({ active: false, expired: false });

let pending: Promise<void> | null = null;

/**
 * Ask the server whether the current session is still valid and update
 * `sessionState.expired`. Concurrent calls share one request. A session that
 * is restored (e.g. by signing in again in another tab) clears the flag.
 *
 * Network and server errors are ignored: only an explicit "no session" answer
 * marks the session as expired.
 *
 * `disableRefresh` keeps the check from extending the session, so checking
 * does not keep an idle user signed in.
 */
export function checkSession(): Promise<void> {
  if (!sessionState.active) return Promise.resolve();
  pending ??= authClient
    .getSession({ query: { disableRefresh: true } })
    .then(({ data, error }) => {
      // Drop the result if the signed-in layout unmounted in the meantime.
      if (!error && sessionState.active) sessionState.expired = !data;
    })
    .catch(() => {})
    .finally(() => {
      pending = null;
    });
  return pending;
}
