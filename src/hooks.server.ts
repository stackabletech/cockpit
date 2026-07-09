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

/** Routes under /api/storage/ that do NOT need a storage connection header. */
const STORAGE_ROUTES_WITHOUT_CONNECTION = new Set([
  '/(app)/api/storage/copy/job/[jobId]',
  '/(app)/api/storage/download',
  '/(app)/api/storage/download/token'
]);

const handleStorageConnection: Handle = async ({ event, resolve }) => {
  if (
    (event.route.id?.startsWith('/(app)/storage/') ||
      event.route.id?.startsWith('/(app)/api/storage/')) &&
    !storageBrowserEnabled
  ) {
    throw error(404, 'Storage browser is not enabled');
  }
  event.locals.storageConfig = getConnectionFromHeader(event.request);
  if (
    event.locals.storageConfig === null &&
    event.route.id?.startsWith('/(app)/api/storage/') &&
    !STORAGE_ROUTES_WITHOUT_CONNECTION.has(event.route.id)
  ) {
    throw error(401, 'No storage connection configured');
  }
  return resolve(event);
};

export const handle = sequence(
  requestLogger,
  handleMetrics,
  handleParaglide,
  ...(oidcEnabled ? [handleAuth, handleAuthGuard] : []),
  handleStorageConnection
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
