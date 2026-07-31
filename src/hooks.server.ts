import { paraglideMiddleware } from '$lib/paraglide/server';
import { httpRequestDuration } from '$lib/server/metrics';
import { building, dev } from '$app/environment';
import { error, redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth, oidcEnabled } from '$lib/server/auth';
import { requestLogger, logger } from '$lib/server/logging';
import { getConnectionFromHeader } from '$lib/server/storage/connection.js';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';

// Allow self-signed TLS certificates in development (e.g. local Trino with self-signed certs).
if (dev) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const handleMetrics: Handle = async ({ event, resolve }) => {
  if (event.route.id === '/metrics') {
    return resolve(event);
  }
  const start = performance.now();
  const response = await resolve(event);
  const duration = (performance.now() - start) / 1000;
  httpRequestDuration.observe(
    {
      method: event.request.method,
      route: event.route.id ?? 'unknown',
      status: response.status
    },
    duration
  );
  return response;
};

const handleParaglide: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;

    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
    });
  });

const handleAuth: Handle = ({ event, resolve }) =>
  svelteKitHandler({ event, resolve, auth, building });

const PUBLIC_PATHS = ['/auth/login', '/auth/logout', '/api/auth', '/metrics', '/healthz'];

const handleAuthGuard: Handle = async ({ event, resolve }) => {
  const session = await auth.api.getSession({ headers: event.request.headers });
  event.locals.user = session?.user ?? null;
  event.locals.session = session?.session ?? null;

  const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
  if (!isPublic && !event.locals.user) {
    const redirectTo = encodeURIComponent(event.url.pathname + event.url.search);
    throw redirect(302, `/auth/login?redirectTo=${redirectTo}`);
  }

  return resolve(event);
};

/**
 * Parse the `x-storage-connection` header (base64 JSON) for every request and
 * store the result in `event.locals.storageConfig`. For routes under
 * `/(app)/api/storage/` the header is mandatory — the middleware throws 401
 * before the handler runs if it is absent, so handlers can rely on
 * `locals.storageConfig` being non-null. Throws 400 for a present but
 * malformed / invalid header on any route.
 */
const handleStorageConnection: Handle = async ({ event, resolve }) => {
  const routeId = event.route.id ?? '';
  const isAppStorage = routeId.startsWith('/(app)/storage/');
  const isStorageApi = routeId.startsWith('/(app)/api/storage/');

  if ((isAppStorage || isStorageApi) && !storageBrowserEnabled) {
    throw error(404, 'Storage browser is not enabled');
  }
  event.locals.storageConfig = getConnectionFromHeader(event.request);
  if (event.locals.storageConfig === null && isStorageApi) {
    throw error(401, 'No storage connection configured');
  }
  return resolve(event);
};

/**
 * Allow pages loaded with `?embed=1` to be displayed inside <iframe> elements
 * from any origin. The `(app)` layout uses the same query parameter to hide
 * the app shell (sidebar/header) so a single module can be embedded on its
 * own.
 *
 * By default browsers block cross-origin framing when the server sets
 * `X-Frame-Options: SAMEORIGIN` or a restrictive `frame-ancestors` CSP.
 * SvelteKit does not set either header by default, so this hook is mainly a
 * defence-in-depth measure and an explicit signal that embedding is intended.
 *
 * For cross-origin embedding to work the session cookie must also carry
 * `SameSite=None; Secure`.  See TECH_DEBT.md for the outstanding action item.
 */
const handleEmbedHeaders: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  if (event.url.searchParams.get('embed') === '1') {
    response.headers.set('X-Frame-Options', 'ALLOWALL');
    response.headers.set(
      'Content-Security-Policy',
      [response.headers.get('Content-Security-Policy'), 'frame-ancestors *']
        .filter(Boolean)
        .join('; ')
    );
  }
  return response;
};

export const handle = sequence(
  requestLogger,
  handleMetrics,
  handleParaglide,
  ...(oidcEnabled ? [handleAuth, handleAuthGuard] : []),
  handleStorageConnection,
  handleEmbedHeaders
);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const requestId = event.locals.requestId;
  const log = event.locals.logger ?? logger;

  log.error({ err: error, status_code: status }, message);

  return {
    message: 'An unexpected error occurred',
    requestId
  };
};
