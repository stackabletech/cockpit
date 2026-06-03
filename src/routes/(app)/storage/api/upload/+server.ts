import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireConnection } from '$lib/server/storage/connection.js';
import { requireBucketKey } from '../params.js';
import type { RequestHandler } from './$types';

/**
 * POST /storage/api/upload?bucket=<bucket>&key=<object-key>
 *
 * Streams an uploaded file directly to S3 using multipart upload (via
 * @aws-sdk/lib-storage). The request body is piped to the S3 SDK without
 * buffering in server memory, regardless of file size.
 *
 * The connection config is read from the `X-Storage-Connection` request header
 * (base64-encoded JSON), set by the client from its localStorage entry.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const log = locals.logger;
  const config = requireConnection(request);
  const { bucket, key } = requireBucketKey(url);

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

  await getProvider(config, bucket).putObject(key, request.body, contentType, contentLength);

  log.info(
    { bucket, key, content_type: contentType, content_length: contentLength },
    'upload completed'
  );

  return new Response(null, { status: 201 });
};
