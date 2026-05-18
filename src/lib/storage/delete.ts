/**
 * Client-side utility for deleting one or more S3 objects via the server proxy.
 */

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

/** Keys that could not be deleted, with an optional reason. */
export type FailedKey = { key: string; code?: string; message?: string };

/** Outcome of a delete request: lists any keys that the server could not remove. */
export type DeleteOutcome = { failedKeys: FailedKey[] };

function mapStatusToCode(status: number): DeleteErrorCode {
  if (status === 401) return 'not_connected';
  if (status === 403) return 'access_denied';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Delete one or more S3 objects.
 *
 * Resolves with `failedKeys` listing any objects the server could not delete
 * (partial S3 failures). Throws a `DeleteError` only on transport/auth errors.
 */
export async function deleteObjects(bucket: string, keys: string[]): Promise<DeleteOutcome> {
  const params = new URLSearchParams({ bucket });
  for (const key of keys) params.append('keys', key);

  const res = await fetch(`/storage/api/delete?${params}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new DeleteError(mapStatusToCode(res.status), `Delete failed with status ${res.status}`);
  }

  const data = (await res.json()) as { failed: FailedKey[] };
  return { failedKeys: data.failed };
}
