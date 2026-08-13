import { paraglideMiddleware } from '$lib/paraglide/server';
import { httpRequestDuration } from '$lib/server/metrics';
import { building, dev } from '$app/environment';
import {
  error,
  redirect,
  type Handle,
  type HandleServerError,
  type ServerInit
} from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth, oidcEnabled } from '$lib/server/auth';
import { requestLogger, logger } from '$lib/server/logging';
import { getConnectionFromHeader } from '$lib/server/storage/connection.js';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';

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
 * Parse the `x-storage-connection-id` header for every request and look up the
 * connection from the database. The decrypted config is stored in
 * `event.locals.storageConfig`. For routes under `/(app)/api/storage/` the
 * header is mandatory — the middleware throws 401 before the handler runs if it
 * is absent, so handlers can rely on `locals.storageConfig` being non-null.
 */
const handleStorageConnection: Handle = async ({ event, resolve }) => {
  if (
    (event.route.id?.startsWith('/(app)/storage/') ||
      event.route.id?.startsWith('/(app)/api/storage/')) &&
    !storageBrowserEnabled
  ) {
    throw error(404, 'Storage browser is not enabled');
  }
  const userId = event.locals.user?.id ?? null;
  if (userId && event.route.id?.startsWith('/(app)/api/storage/')) {
    event.locals.storageConfig = await getConnectionFromHeader(event.request, userId);
  } else {
    event.locals.storageConfig = null;
  }
  // The connections management endpoint itself does not require a connection header —
  // it is used to list/create connections before one is selected.
  // The copy/job polling endpoint also does not require a connection header —
  // it reads job status from the server-side job store.
  const requiresConnectionHeader =
    event.route.id?.startsWith('/(app)/api/storage/') &&
    !event.route.id?.startsWith('/(app)/api/storage/connections') &&
    !event.route.id?.startsWith('/(app)/api/storage/copy/job/') &&
    !event.route.id?.startsWith('/(app)/api/storage/download/jobs/');
  if (event.locals.storageConfig === null && requiresConnectionHeader) {
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

/**
 * Validate required environment variables at server startup (fail-fast).
 * This runs once before any requests are handled, so misconfiguration is
 * detected immediately rather than on the first request that uses the key.
 */
export const init: ServerInit = async () => {
  if (storageBrowserEnabled) {
    storageEncryptionKey(); // throws immediately if the env var is missing/invalid
  }
};

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const requestId = event.locals.requestId;
  const log = event.locals.logger ?? logger;

  log.error({ err: error, status_code: status }, message);

  return {
    message: 'An unexpected error occurred',
    requestId
  };
};
