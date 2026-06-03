import type { RequestHandler } from './$types';
import { downloadObject, getObjectMetadata } from '$lib/server/storage/service.js';
import { requireConnection } from '$lib/server/storage/connection.js';
import { requireBucketKey } from '../params.js';

/** Derive the bare filename from a (possibly path-prefixed) object key. */
function filenameFromKey(key: string): string {
  return key.split('/').filter(Boolean).pop() ?? key;
}

/**
 * GET /storage/api/download?bucket=<bucket>&key=<object-key>
 *
 * Proxies an S3 object directly to the client as a streaming download.
 * Authentication is enforced by the app-level auth guard in hooks.server.ts.
 * The S3 body stream is piped straight to the HTTP response — no server-side
 * buffering occurs.
 *
 * The connection config is read from the `X-Storage-Connection` request header
 * (base64-encoded JSON), set by the client from its localStorage entry.
 */
export const GET: RequestHandler = async ({ locals, url, request }) => {
  const { bucket, key } = requireBucketKey(url);
  const config = requireConnection(request);

  locals.logger.debug({ bucket, key }, 'download request received');

  const download = await downloadObject(config, bucket, key);

  const filename = filenameFromKey(key);
  // RFC 5987 encoding for non-ASCII filenames in Content-Disposition
  const encodedFilename = encodeURIComponent(filename);
  const contentDisposition = `attachment; filename="${filename}"; filename*=UTF-8''${encodedFilename}`;

  const headers: Record<string, string> = {
    'Content-Disposition': contentDisposition,
    'Content-Type': download.contentType ?? 'application/octet-stream',
    'Cache-Control': 'private, no-store'
  };

  if (download.contentLength !== undefined) {
    headers['Content-Length'] = String(download.contentLength);
  }

  if (download.etag) {
    headers['ETag'] = download.etag;
  }

  locals.logger.info({ bucket, key, filename }, 'streaming object download');

  return new Response(download.stream, { status: 200, headers });
};

/**
 * HEAD /storage/api/download?bucket=<bucket>&key=<object-key>
 *
 * Lightweight pre-flight that validates credentials and access rights using
 * a HeadObject call (no object body transferred). The client uses this before
 * initiating a download to surface auth/not-found errors as inline UI messages.
 *
 * The connection config is read from the `X-Storage-Connection` request header.
 */
export const HEAD: RequestHandler = async ({ locals, url, request }) => {
  const { bucket, key } = requireBucketKey(url);
  const config = requireConnection(request);

  locals.logger.debug({ bucket, key }, 'download pre-flight check');

  const meta = await getObjectMetadata(config, bucket, key);

  return new Response(null, {
    status: 200,
    headers: {
      'Content-Type': meta.contentType ?? 'application/octet-stream',
      'Content-Length': String(meta.size)
    }
  });
};
