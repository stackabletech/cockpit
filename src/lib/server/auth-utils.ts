import { error } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import { oidcEnabled } from '$lib/server/auth';

export function getUserId(locals: App.Locals): string {
  return locals.user?.id ?? 'anonymous';
}

/**
 * The signed-in user's id for per-user API routes. Without OIDC this is the
 * shared local user; a request without a user answers 401.
 */
export function requireUserId(locals: App.Locals): string {
  if (!locals.user) throw error(401, 'Authentication required');
  return locals.user.id;
}

/**
 * The user to impersonate in Trino. Without OIDC everyone is the shared local
 * user, so queries run as 'anonymous'. A signed-in OIDC user without a Trino
 * user means sign-up lost the OIDC claim; return null instead of falling back
 * to 'anonymous'.
 */
export function findTrinoUser(locals: App.Locals): string | null {
  if (!oidcEnabled || !locals.user) return 'anonymous';
  if (locals.user.trinoUser) return locals.user.trinoUser;
  locals.logger.warn({ user_id: locals.user.id }, 'Signed-in user has no Trino user');
  return null;
}

/** Like {@link findTrinoUser}, but fails the request when there is no Trino user. */
export function getTrinoUser(locals: App.Locals): string {
  return findTrinoUser(locals) ?? error(500, m.trino_user_missing());
}
