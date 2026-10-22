import { isHttpError } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // TLS handshake against a plain-HTTP port (https host with the wrong port).
  'EPROTO'
]);

/** The error, the members of an AggregateError, and the `cause` chain of each. */
function relatedErrors(err: unknown, depth = 0): unknown[] {
  if (!err || typeof err !== 'object' || depth > 5) return [];
  const nested = [
    ...(err instanceof AggregateError ? err.errors : []),
    ...('cause' in err ? [err.cause] : [])
  ];
  return [err, ...nested.flatMap((e) => relatedErrors(e, depth + 1))];
}

/**
 * Whether a connection failure comes from the network rather than from S3. Checks the Node error
 * code: connecting to `localhost` tries IPv6 and IPv4 and fails with an AggregateError whose
 * message is empty, but whose code (and each inner error's code) is set. The AWS SDK reports its
 * connection timeout as a `TimeoutError` without a code.
 */
function isNetworkError(err: Error): boolean {
  return relatedErrors(err).some((e) => {
    const { code, name, message } = e as { code?: unknown; name?: unknown; message?: unknown };
    if (
      typeof code === 'string' &&
      (NETWORK_ERROR_CODES.has(code) || code.startsWith('ERR_SSL_'))
    ) {
      return true;
    }
    if (name === 'TimeoutError') return true;
    return (
      typeof message === 'string' &&
      /econnrefused|enotfound|eai_again|etimedout|eproto|timed out|network/.test(
        message.toLowerCase()
      )
    );
  });
}

/** User-facing message for a failed connection test (listing the buckets of a new connection). */
export function connectionTestErrorMessage(err: unknown): string {
  if (isHttpError(err)) {
    if (err.status === 403) return m.storage_connect_error_access_denied();
    if (err.status === 404) return m.storage_connect_error_not_found();
    if (err.status === 502) return m.storage_connect_error_server_error();
    return m.storage_connect_error();
  }
  if (err instanceof Error && isNetworkError(err)) {
    return m.storage_connect_error_network();
  }
  return m.storage_connect_error();
}
