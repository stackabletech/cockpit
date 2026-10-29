import { error } from '@sveltejs/kit';

export function getUserId(locals: App.Locals): string {
  return locals.user?.id ?? 'anonymous';
}

/**
 * The signed-in user's id for per-user API routes. Without OIDC there is no
 * user (the auth guard does not run), so such routes answer 401.
 */
export function requireUserId(locals: App.Locals): string {
  if (!locals.user) throw error(401, 'Authentication required');
  return locals.user.id;
}
