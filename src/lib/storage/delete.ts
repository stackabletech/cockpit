/**
 * Client-side utility for deleting one or more S3 objects via the server proxy.
 */

import type { DeleteObjectsResult } from '$lib/storage/types.js';

export type DeleteErrorCode = 'not_connected' | 'access_denied' | 'server_error' | 'unknown';

export class DeleteError extends Error {
  constructor(
    public readonly code: DeleteErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DeleteError';
  }
}

function mapStatusToCode(status: number): DeleteErrorCode {
  if (status === 401) return 'not_connected';
  if (status === 403) return 'access_denied';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Delete one or more S3 objects.
 *
 * Resolves with `failed` listing any objects the server could not delete
 * (partial S3 failures). Throws a `DeleteError` only on transport/auth errors.
 */
export async function deleteObjects(bucket: string, keys: string[]): Promise<DeleteObjectsResult> {
  const params = new URLSearchParams({ bucket });
  for (const key of keys) params.append('keys', key);

  const res = await fetch(`/storage/api/delete?${params}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new DeleteError(mapStatusToCode(res.status), `Delete failed with status ${res.status}`);
  }

  return (await res.json()) as DeleteObjectsResult;
}
