import { randomUUID } from 'node:crypto';
import type { Handle } from '@sveltejs/kit';
import { logger } from './logger.js';

/**
 * SvelteKit handle hook that creates a request-scoped child logger
 * with a bound request ID, method, and path. Logs request completion
 * with duration and status-appropriate log level.
 */
export const requestLogger: Handle = async ({ event, resolve }) => {
  const requestId = event.request.headers.get('x-request-id') ?? randomUUID();
  const method = event.request.method;
  const path = event.url.pathname;

  const log = logger.child({ request_id: requestId, method, path });

  event.locals.logger = log;
  event.locals.requestId = requestId;

  log.trace('Request started');

  const start = performance.now();

  const response = await resolve(event);

  const durationMs = Math.round(performance.now() - start);
  const statusCode = response.status;
  const logData = { status_code: statusCode, duration_ms: durationMs };

  if (statusCode >= 500) {
    log.error(logData, 'Request completed');
  } else if (statusCode >= 400) {
    log.info(logData, 'Request completed');
  } else {
    log.trace(logData, 'Request completed');
  }

  response.headers.set('x-request-id', requestId);

  return response;
};
