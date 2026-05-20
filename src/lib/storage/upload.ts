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
 */

export type UploadErrorCode =
  | 'not_connected'
  | 'access_denied'
  | 'no_such_bucket'
  | 'invalid_part'
  | 'server_error'
  | 'unknown';

export class UploadError extends Error {
  constructor(
    public readonly code: UploadErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

function buildUploadUrl(bucket: string, key: string): string {
  return `/storage/api/upload?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
}

function buildDownloadUrl(bucket: string, key: string): string {
  return `/storage/api/download?bucket=${encodeURIComponent(bucket)}&key=${encodeURIComponent(key)}`;
}

function mapStatusToUploadCode(status: number): UploadErrorCode {
  if (status === 403) return 'access_denied';
  if (status === 404) return 'no_such_bucket';
  if (status === 400) return 'invalid_part';
  if (status === 401) return 'not_connected';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

/**
 * Check whether an object with the given key already exists in the bucket.
 *
 * Uses a HEAD request to the download endpoint (which calls HeadObject internally)
 * so no object body is transferred. Returns `true` if the object exists, `false`
 * if it does not. Throws `UploadError` for auth or server errors.
 */
export async function checkObjectExists(bucket: string, key: string): Promise<boolean> {
  const url = buildDownloadUrl(bucket, key);
  const res = await fetch(url, { method: 'HEAD' });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  if (res.status === 401) throw new UploadError('not_connected', 'Not connected');
  if (res.status === 403) throw new UploadError('access_denied', 'Access denied');
  throw new UploadError('server_error', `Unexpected status ${res.status}`);
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
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const url = buildUploadUrl(bucket, key);

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
      const code = mapStatusToUploadCode(xhr.status);
      reject(new UploadError(code, `Upload failed with status ${xhr.status}`));
    });

    xhr.addEventListener('error', () => {
      reject(new UploadError('server_error', 'Network error during upload'));
    });

    xhr.addEventListener('abort', () => {
      reject(new UploadError('unknown', 'Upload aborted'));
    });

    xhr.open('POST', url);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });
}
