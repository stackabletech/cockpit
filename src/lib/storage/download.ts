<<<<<<< HEAD
import { STORAGE_CONNECTION_HEADER } from '$lib/storage/connection-storage.js';
=======
/**
 * Client-side utility for downloading a single S3 object via the server proxy.
 *
 * Strategy:
 *  1. Fetch the object with the `x-storage-connection-id` header carrying the
 *     active connection UUID from the connection store.
 *  2. On error: throw a `DownloadError` with a typed `code` so the caller can
 *     display a localised message.
 *  3. On success: create a Blob URL and trigger a native browser download via a
 *     programmatic anchor click.
 *
 * Note: The response body is buffered as a Blob before the download link is
 * constructed. This avoids exposing credentials in the URL (query-param approach)
 * while keeping the implementation simple. For very large files this will use
 * proportional browser memory — see TECH_DEBT.md for the long-term fix.
 */

import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
>>>>>>> origin/feat/s3-file-browser-v1

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
  return `/api/storage/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
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
<<<<<<< HEAD
 * Strategy:
 *  1. Send a HEAD request to validate access (catches 401/403/404 errors fast).
 *  2. Exchange the connection header for a short-lived, single-use token via
 *     POST /api/storage/download/token.
 *  3. Navigate to the download URL with the token — the browser issues a native
 *     GET request, streams the response directly to disk, and shows a download
 *     immediately without buffering the whole object in JS memory.
=======
 * Fetches the object with the connection ID header, buffers it as a Blob,
 * then triggers a native browser download via a programmatic anchor click.
>>>>>>> origin/feat/s3-file-browser-v1
 *
 * @throws {DownloadError} when the server returns a non-2xx response.
 */
export async function downloadObject(
  bucket: string,
  key: string,
  connectionId: string
): Promise<void> {
  const url = buildDownloadUrl(bucket, key);
  const filename = key.split('/').filter(Boolean).pop() ?? key;

<<<<<<< HEAD
  // 1. Pre-flight HEAD check — validates access rights without transferring body.
  const headResponse = await fetch(url, {
    method: 'HEAD',
    headers: { [STORAGE_CONNECTION_HEADER]: connectionHeader }
=======
  const response = await fetch(url, {
    headers: { [STORAGE_CONNECTION_ID_HEADER]: connectionId }
>>>>>>> origin/feat/s3-file-browser-v1
  });

  if (!headResponse.ok) {
    const code = mapStatusToCode(headResponse.status);
    throw new DownloadError(code, `Download failed with status ${headResponse.status}`);
  }

  // 2. Exchange the connection header for a short-lived token that can be
  //    passed as a URL parameter (browser navigation cannot set custom headers).
  const tokenRes = await fetch('/api/storage/download/token', {
    method: 'POST',
    headers: { [STORAGE_CONNECTION_HEADER]: connectionHeader }
  });

  if (!tokenRes.ok) {
    throw new DownloadError('server_error', 'Failed to create download token');
  }

  const { token } = (await tokenRes.json()) as { token: string };

  // 3. Navigate to the download URL with the token. The browser issues a native
  //    GET request, sees Content-Disposition: attachment, and streams the object
  //    directly to disk — no JS-side buffering.
  const tokenUrl = `${url}&token=${encodeURIComponent(token)}`;
  const anchor = document.createElement('a');
  anchor.href = tokenUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
