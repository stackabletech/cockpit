import { paraglideMiddleware } from '$lib/paraglide/server';
import { type Handle, type HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { dev } from '$app/environment';
import { requestLogger } from '$lib/server/logging';
import { logger } from '$lib/server/logging';

// Allow self-signed TLS certificates in development (e.g. local Trino with self-signed certs).
if (dev) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const handleParaglide: Handle = ({ event, resolve }) =>
  paraglideMiddleware(event.request, ({ request, locale }) => {
    event.request = request;

    return resolve(event, {
      transformPageChunk: ({ html }) => html.replace('%paraglide.lang%', locale)
    });
  });

// Each function acts as a middleware, receiving the request handle
// And returning a handle which gets passed to the next function
export const handle = sequence(requestLogger, handleParaglide);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
  const requestId = event.locals.requestId;
  const log = event.locals.logger ?? logger;

  log.error({ err: error, status_code: status }, message);

  return {
    message: 'An unexpected error occurred',
    requestId
  };
};
