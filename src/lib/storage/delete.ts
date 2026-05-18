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

function mapStatusToCode(status: number): DeleteErrorCode {
  if (status === 401) return 'not_connected';
  if (status === 403) return 'access_denied';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Delete one or more S3 objects.
 *
 * @throws {DeleteError} when the server returns a non-2xx response.
 */
export async function deleteObjects(bucket: string, keys: string[]): Promise<void> {
  const params = new URLSearchParams({ bucket });
  for (const key of keys) params.append('keys', key);

  const res = await fetch(`/storage/api/delete?${params}`, { method: 'DELETE' });
  if (!res.ok) {
    throw new DeleteError(mapStatusToCode(res.status), `Delete failed with status ${res.status}`);
  }
}
