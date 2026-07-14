import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucketKey } from '../params.js';

/** Derive the bare filename from a (possibly path-prefixed) object key. */
function filenameFromKey(key: string): string {
  return key.split('/').filter(Boolean).pop() ?? key;
}

/**
 * GET /api/storage/download?bucket=<bucket>&key=<object-key>
 *
 * Proxies an S3 object directly to the client as a streaming download.
 * Authentication is enforced by the app-level auth guard in hooks.server.ts.
 * The S3 body stream is piped straight to the HTTP response — no server-side
 * buffering occurs.
 *
 * The connection config is resolved from `locals.storageConfig` which is set
 * by the handleStorageConnection middleware using the x-storage-connection-id
 * header and a database lookup.
 */
export const GET: RequestHandler = async ({ locals, request, url }) => {
  const { bucket, key } = requireBucketKey(url);

  locals.logger.debug({ bucket, key }, 'download request received');

  const config = locals.storageConfig;

  if (!config) {
    throw error(401, 'No storage connection configured');
  }

  const download = await getProvider(config, bucket).getObject(key);

  // When the client cancels the download (closes the connection), abort the S3
  // stream proactively so the backend stops fetching data from S3.
  const abortController = new AbortController();
  request.signal.addEventListener(
    'abort',
    () => {
      locals.logger.info({ bucket, key }, 'client cancelled download — aborting S3 stream');
      abortController.abort();
    },
    { once: true }
  );

  // Pipe the S3 stream through a TransformStream that honours the abort signal.
  // This ensures the S3 SDK stops reading when the client disconnects.
  const { readable, writable } = new TransformStream();
  download.stream.pipeTo(writable, { signal: abortController.signal }).catch(() => {});

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

  return new Response(readable, { status: 200, headers });
};

/**
 * HEAD /api/storage/download?bucket=<bucket>&key=<object-key>
 *
 * Lightweight pre-flight that validates credentials and access rights using
 * a HeadObject call (no object body transferred). The client uses this before
 * initiating a download to surface auth/not-found errors as inline UI messages.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const HEAD: RequestHandler = async ({ locals, url }) => {
  const { bucket, key } = requireBucketKey(url);

  locals.logger.debug({ bucket, key }, 'download pre-flight check');

  const meta = await getProvider(locals.storageConfig!, bucket).getMetadata(key);

  return new Response(null, {
    status: 200,
    headers: {
      'Content-Type': meta.contentType ?? 'application/octet-stream',
      'Content-Length': String(meta.size)
    }
  });
};
