/**
 * Client-side utility for downloading a single S3 object via the server proxy.
 *
 * Strategy:
 *  1. Send a HEAD request to validate credentials and access rights without
 *     transferring the object body (server uses HeadObject internally).
 *  2. On error: throw a `DownloadError` with a typed `code` so the caller can
 *     display a localised message.
 *  3. On success: trigger a native browser download via a programmatic anchor
 *     click. The browser streams the object directly to disk — no client-side
 *     buffering occurs regardless of file size.
 */

export type DownloadErrorCode =
  | 'not_connected'
  | 'access_denied'
  | 'not_found'
  | 'server_error'
  | 'unknown';

export class DownloadError extends Error {
  constructor(
    public readonly code: DownloadErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DownloadError';
  }
}

function buildDownloadUrl(bucket: string, key: string): string {
  return `/storage/api/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
}

function mapStatusToCode(status: number): DownloadErrorCode {
  if (status === 401) return 'not_connected';
  if (status === 403) return 'access_denied';
  if (status === 404) return 'not_found';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Download a single S3 object.
 *
 * Performs a HEAD pre-flight to surface auth and access errors as typed
 * `DownloadError` exceptions, then triggers a native browser download for
 * the actual transfer so the file streams straight to disk.
 *
 * @throws {DownloadError} when the server returns a non-2xx response on the
 *   pre-flight check.
 */
export async function downloadObject(bucket: string, key: string): Promise<void> {
  const url = buildDownloadUrl(bucket, key);

  // Pre-flight: validate credentials and access without fetching the body.
  const check = await fetch(url, { method: 'HEAD' });
  if (!check.ok) {
    const code = mapStatusToCode(check.status);
    throw new DownloadError(code, `Download pre-flight failed with status ${check.status}`);
  }

  // Derive filename from the key (last path segment).
  const filename = key.split('/').filter(Boolean).pop() ?? key;

  // Trigger a native browser download. The browser sends the session cookie
  // automatically and streams the response body directly to disk.
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
