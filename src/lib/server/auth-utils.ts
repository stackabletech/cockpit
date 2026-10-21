import { error } from '@sveltejs/kit';

export function getUserId(locals: App.Locals): string {
  return locals.user?.id ?? 'anonymous';
}

/**
 * The user to impersonate in Trino. Without OIDC there is no signed-in user,
 * so queries run as 'anonymous'. A signed-in user without a username means
 * sign-up lost the OIDC claim; return null instead of falling back to 'anonymous'.
 */
export function findTrinoUser(locals: App.Locals): string | null {
  if (!locals.user) return 'anonymous';
  if (locals.user.username) return locals.user.username;
  locals.logger.error({ user_id: locals.user.id }, 'Signed-in user has no Trino username');
  return null;
}

/** Like {@link findTrinoUser}, but fails the request when there is no username. */
export function getTrinoUser(locals: App.Locals): string {
  return findTrinoUser(locals) ?? error(500, 'User has no Trino username');
}
