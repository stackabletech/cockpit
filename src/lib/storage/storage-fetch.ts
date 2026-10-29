/**
 * Centralised fetch wrapper for all storage API calls.
 *
 * Every storage endpoint requires the `x-storage-connection-id` header.
 * This module eliminates the repeated pattern of:
 *   1. Reading the connection ID from the store
 *   2. Setting the header
 *   3. Calling fetch
 *   4. Mapping HTTP status to a StorageErrorCode
 *
 * Usage via the factory:
 *   const fetch_ = createStorageFetch(() => connectionStore.activeConnectionId);
 */

import { readErrorMessage } from '$lib/client/api-error.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import { StorageError } from '$lib/storage/errors.js';

/**
 * Map an HTTP status code to a StorageError code.
 *
 * This consolidates the duplicated mapping that previously appeared in
 * `state.svelte.ts`, `download.ts`, and `upload.ts`.
 */
export function mapStatusToCode(status: number): string {
  if (status === 403) return 'access_denied';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 413) return 'file_too_large';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Whether an error body says the request has no usable storage connection.
 * The server answers that with 409 and `reason: 'not-connected'`, keeping 401
 * for an expired session.
 */
export function isNotConnectedBody(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && 'reason' in body && body.reason === 'not-connected'
  );
}

/** StorageError code for a failed response, given its parsed body. */
export function errorCodeFor(status: number, body: unknown): string {
  return isNotConnectedBody(body) ? 'not_connected' : mapStatusToCode(status);
}

/**
 * Create a `storageFetch` function bound to a connection-ID getter.
 *
 * @param getConnectionId  A function that returns the active connection ID,
 *                         or `null` when no connection is active.
 * @returns A fetch-like function that automatically injects the connection
 *          header and throws `StorageError` on failure.
 */
export function createStorageFetch(
  getConnectionId: () => string | null
): (path: string, init?: RequestInit) => Promise<Response> {
  return async function storageFetch(path: string, init?: RequestInit): Promise<Response> {
    const connectionId = getConnectionId();
    if (!connectionId) {
      throw new StorageError('not_connected', 'No active storage connection');
    }

    const headers = new Headers(init?.headers);
    headers.set(STORAGE_CONNECTION_ID_HEADER, connectionId);

    const response = await fetch(path, { ...init, headers });

    if (!response.ok) {
      const body: unknown = await response
        .clone()
        .json()
        .catch(() => null);
      const code = errorCodeFor(response.status, body);
      const message =
        (await readErrorMessage(response)) ?? `Request failed with status ${response.status}`;
      throw new StorageError(code, message);
    }

    return response;
  };
}
