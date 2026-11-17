// Request body limit for every route except uploads.
//
// adapter-node's BODY_SIZE_LIMIT is global and sized for file uploads (5G in
// the image), but most handlers buffer the whole body: better-auth parses it
// before its own checks, JSON endpoints call `request.json()`, form actions
// `request.formData()`. This hook rejects such bodies by their declared length
// before any handler reads them.

import { json, text, type Handle } from '@sveltejs/kit';
import { maxEditableFileSize } from '$lib/server/storage/config.js';

const MiB = 1024 * 1024;

/** Routes that stream their body and are bounded by BODY_SIZE_LIMIT only. */
const UNLIMITED_ROUTE_IDS = new Set(['/(app)/api/storage/upload']);

/**
 * The body limit for all other routes: 6 MiB, the former BODY_SIZE_LIMIT of
 * the image, but at least the largest file the text editor saves plus 1 MiB
 * of headroom, so raising `PUBLIC_STACKABLE_COCKPIT_MAX_EDITABLE_FILE_SIZE`
 * keeps saving working.
 */
export function deriveRequestBodyLimit(editableFileSize: number): number {
  return Math.max(6 * MiB, editableFileSize + MiB);
}

/**
 * API routes get JSON for `fetch` callers, pages plain text. Both are returned
 * rather than thrown with `error()`, whose error page cannot set headers:
 * `Connection: close` lets Node drop the socket instead of draining the unread
 * body.
 */
function reject(pathname: string, status: 411 | 413, message: string): Response {
  const headers = { connection: 'close' };
  if (pathname.startsWith('/api/')) {
    return json({ message }, { status, headers });
  }
  return text(message, { status, headers });
}

/** Builds the hook; `limit` is a parameter for the tests. */
export function createRequestBodyLimitHandle(limit: number): Handle {
  return async ({ event, resolve }) => {
    if (event.route.id !== null && UNLIMITED_ROUTE_IDS.has(event.route.id)) {
      return resolve(event);
    }
    const { headers } = event.request;
    const rawLength = headers.get('content-length');
    const log = event.locals.logger;

    if (rawLength === null) {
      // Without Content-Length or Transfer-Encoding there is no body.
      if (headers.get('transfer-encoding') === null) return resolve(event);
      log.debug({ route: event.route.id }, 'Rejecting request body without Content-Length');
      return reject(event.url.pathname, 411, 'Content-Length required');
    }

    const contentLength = Number(rawLength);
    if (contentLength > limit) {
      log.debug(
        { route: event.route.id, content_length: contentLength, limit_bytes: limit },
        'Rejecting request body above the limit'
      );
      return reject(
        event.url.pathname,
        413,
        `Content-length of ${contentLength} exceeds limit of ${limit} bytes.`
      );
    }
    return resolve(event);
  };
}

export const handleRequestBodyLimit = createRequestBodyLimitHandle(
  deriveRequestBodyLimit(maxEditableFileSize)
);
