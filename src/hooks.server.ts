import { paraglideMiddleware } from '$lib/paraglide/server';
import { httpRequestDuration } from '$lib/server/metrics';
import { building, dev } from '$app/environment';
import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth, oidcEnabled } from '$lib/server/auth';
import { requestLogger, logger } from '$lib/server/logging';

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

export const handle = sequence(
  requestLogger,
  handleMetrics,
  handleParaglide,
  ...(oidcEnabled ? [handleAuth, handleAuthGuard] : [])
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
