import type { Cookies } from '@sveltejs/kit';
import { auth } from '$lib/server/auth.js';

const ACTIVE_CONNECTION_COOKIE = 'storage-active-connection-id';

/**
 * Reads the active storage connection ID. Backed by the better-auth session
 * when a real session exists; falls back to a plain cookie when running
 * without OIDC, since no session is ever created in that mode (see getUserId).
 */
export function getActiveStorageConnectionId(locals: App.Locals, cookies: Cookies): string | null {
  if (locals.session) {
    return locals.session.activeStorageConnectionId ?? null;
  }
  return cookies.get(ACTIVE_CONNECTION_COOKIE) ?? null;
}

/**
 * Sets or clears the active storage connection ID, mirroring the read side above.
 */
export async function setActiveStorageConnectionId(
  event: { request: Request; locals: App.Locals; cookies: Cookies },
  connectionId: string | null
): Promise<void> {
  if (event.locals.session) {
    await auth.api.updateSession({
      headers: event.request.headers,
      body: { activeStorageConnectionId: connectionId }
    });
    return;
  }
  if (connectionId) {
    event.cookies.set(ACTIVE_CONNECTION_COOKIE, connectionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax'
    });
  } else {
    event.cookies.delete(ACTIVE_CONNECTION_COOKIE, { path: '/' });
  }
}
