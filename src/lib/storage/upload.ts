/**
 * Client-side utilities for uploading a single file to S3 via the server proxy.
 *
 * Strategy:
 * - `checkObjectExists` performs a lightweight HEAD request against the download
 *   endpoint to check whether an object with the target key already exists.
 * - `uploadFile` uses XMLHttpRequest (not fetch) so that upload progress events
 *   are available. fetch upload progress requires `duplex: 'half'` which is not
 *   supported in Firefox.
 * - The file is sent as the raw request body — no base64 or multipart encoding.
 *   The server streams it directly to S3, preserving binary integrity.
 * - The active connection UUID is passed via the `x-storage-connection-id` header.
 */

import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import { StorageError } from '$lib/storage/errors.js';
import { createStorageFetch, errorCodeFor } from '$lib/storage/storage-fetch.js';

/**
 * Check whether an object with the given key already exists in the bucket.
 *
 * Uses a HEAD request to the download endpoint (which calls HeadObject internally)
 * so no object body is transferred. Returns `true` if the object exists, `false`
 * if it does not. Throws on any other failure (`StorageError` for auth or server
 * errors, the fetch error for network failures); callers must not treat that as
 * "does not exist".
 */
export async function checkObjectExists(
  bucket: string,
  key: string,
  connectionId: string
): Promise<boolean> {
  const fetch_ = createStorageFetch(() => connectionId);
  try {
    // storageFetch throws on any non-2xx response, so reaching here means it exists.
    await fetch_(
      `/api/storage/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
      { method: 'HEAD' }
    );
    return true;
  } catch (err) {
    if (err instanceof StorageError && err.code === 'not_found') return false;
    throw err;
  }
}

/**
 * Upload a single file to the given bucket + key.
 *
 * Uses XMLHttpRequest so that `upload.onprogress` fires with byte-level progress.
 * The File object is sent as the raw request body — the server proxies it to S3
 * without buffering.
 *
 * @param onProgress - Called with a progress percentage (0–100) during upload.
 * @param signal - Aborts the upload request.
 * @throws {UploadError} on non-2xx responses.
 */
export function uploadFile(
  bucket: string,
  key: string,
  file: File,
  onProgress: (pct: number) => void,
  connectionId: string,
  signal?: AbortSignal
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new StorageError('unknown', 'Upload aborted'));
      return;
    }
    const xhr = new XMLHttpRequest();
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    const url = `/api/storage/upload?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Not a JSON error body, e.g. a proxy's error page.
      }
      const code = errorCodeFor(xhr.status, body);
      reject(new StorageError(code, `Upload failed with status ${xhr.status}`));
    });

    xhr.addEventListener('error', () => {
      reject(new StorageError('server_error', 'Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new StorageError('unknown', 'Upload aborted'));
    });

    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader(STORAGE_CONNECTION_ID_HEADER, connectionId);
    xhr.send(file);
  });
}
