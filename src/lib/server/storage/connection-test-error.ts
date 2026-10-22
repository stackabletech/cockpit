import { isHttpError } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';

const NETWORK_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH'
]);

/**
 * Whether a connection failure comes from the network rather than from S3. Checks the Node error
 * code: connecting to `localhost` tries IPv6 and IPv4 and fails with an AggregateError whose
 * message is empty, but whose code (and each inner error's code) is set.
 */
function isNetworkError(err: Error): boolean {
  const errors = [err, ...(err instanceof AggregateError ? err.errors : [])];
  if (errors.some((e) => NETWORK_ERROR_CODES.has((e as { code?: unknown })?.code as string))) {
    return true;
  }
  return /econnrefused|enotfound|eai_again|etimedout|network/.test(err.message.toLowerCase());
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
