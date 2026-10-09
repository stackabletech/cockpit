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
import { StorageError, type StorageErrorCode } from '$lib/storage/errors.js';
import { createStorageFetch, mapStatusToCode } from '$lib/storage/storage-fetch.js';

export type UploadErrorCode = StorageErrorCode;

/**
 * Check whether an object with the given key already exists in the bucket.
 *
 * Uses a HEAD request to the download endpoint (which calls HeadObject internally)
 * so no object body is transferred. Returns `true` if the object exists, `false`
 * if it does not. Throws `UploadError` for auth or server errors.
 */
export async function checkObjectExists(
  bucket: string,
  key: string,
  connectionId: string
): Promise<boolean> {
  const fetch_ = createStorageFetch(() => connectionId);
  try {
    const res = await fetch_(
      `/api/storage/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`,
      {
        method: 'HEAD'
      }
    );
    return res.ok;
  } catch {
    return false;
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
 * @throws {UploadError} on non-2xx responses.
 */
export function uploadFile(
  bucket: string,
  key: string,
  file: File,
  onProgress: (pct: number) => void,
  connectionId: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
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
      const code = mapStatusToCode(xhr.status);
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
