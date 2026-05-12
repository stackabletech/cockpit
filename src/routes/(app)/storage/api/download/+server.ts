import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { downloadObject, getObjectMetadata } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';

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
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const bucket = url.searchParams.get('bucket');
  if (!bucket || !bucket.trim()) {
    throw error(400, 'Missing required query parameter: bucket');
  }

  const key = url.searchParams.get('key');
  if (!key || !key.trim()) {
    throw error(400, 'Missing required query parameter: key');
  }

  const userId = getUserId(locals);

  locals.logger.debug({ bucket, key }, 'download request received');

  const download = await downloadObject(userId, bucket, key);

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
 * initiating a native browser download to surface auth/not-found errors as
 * inline UI messages rather than browser download failures.
 */
export const HEAD: RequestHandler = async ({ locals, url }) => {
  const bucket = url.searchParams.get('bucket');
  if (!bucket || !bucket.trim()) {
    throw error(400, 'Missing required query parameter: bucket');
  }

  const key = url.searchParams.get('key');
  if (!key || !key.trim()) {
    throw error(400, 'Missing required query parameter: key');
  }

  const userId = getUserId(locals);

  locals.logger.debug({ bucket, key }, 'download pre-flight check');

  const meta = await getObjectMetadata(userId, bucket, key);

  return new Response(null, {
    status: 200,
    headers: {
      'Content-Type': meta.contentType ?? 'application/octet-stream',
      'Content-Length': String(meta.size)
    }
  });
};
