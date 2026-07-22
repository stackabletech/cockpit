/**
 * Client-side utility for downloading a single S3 object via the server proxy.
 *
 * Strategy:
 *  1. Fetch the object with the `X-Storage-Connection` header carrying the
 *     connection config from localStorage.
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

import { STORAGE_CONNECTION_HEADER } from '$lib/storage/connection-storage.js';

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
 * Fetches the object with the connection config header, buffers it as a Blob,
 * then triggers a native browser download via a programmatic anchor click.
 *
 * @throws {DownloadError} when the server returns a non-2xx response.
 */
export async function downloadObject(
  bucket: string,
  key: string,
  connectionHeader: string
): Promise<void> {
  const url = buildDownloadUrl(bucket, key);

  const response = await fetch(url, {
    headers: { [STORAGE_CONNECTION_HEADER]: connectionHeader }
  });

  if (!response.ok) {
    const code = mapStatusToCode(response.status);
    throw new DownloadError(code, `Download failed with status ${response.status}`);
  }

  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);

  // Derive filename from the key (last path segment).
  const filename = key.split('/').filter(Boolean).pop() ?? key;

  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // Release the object URL after a short delay to allow the browser to initiate
  // the download before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
}
