import { error } from '@sveltejs/kit';
import { withStorage } from '../_middleware.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/storage/upload?bucket=<bucket>&key=<object-key>
 *
 * Streams an uploaded file directly to S3 using multipart upload (via
 * @aws-sdk/lib-storage). The request body is piped to the S3 SDK without
 * buffering in server memory, regardless of file size.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async (event) => {
  const { provider, params } = await withStorage(event);
  const { bucket, key } = params;
  if (!key) throw error(400, 'Missing required query parameter: key');
  const { locals, request } = event;
  const log = locals.logger;

  if (!request.body) {
    throw error(400, 'Missing request body');
  }

  const contentType = (request.headers.get('Content-Type') ?? 'application/octet-stream')
    .split(';')[0]
    .trim();

  const rawLength = request.headers.get('Content-Length');
  const contentLength = rawLength ? parseInt(rawLength, 10) : undefined;

  log.debug(
    { bucket, key, content_type: contentType, content_length: contentLength },
    'upload request received'
  );

  await provider.putObject(key, request.body, contentType, contentLength);

  log.info(
    { bucket, key, content_type: contentType, content_length: contentLength },
    'upload completed'
  );

  return new Response(null, { status: 201 });
};
