import { error } from '@sveltejs/kit';
import { uploadObject } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { requireBucketKey } from '../params.js';
import type { RequestHandler } from './$types';

/**
 * POST /storage/api/upload?bucket=<bucket>&key=<object-key>
 *
 * Streams an uploaded file directly to S3 using multipart upload (via
 * @aws-sdk/lib-storage). The request body is piped to the S3 SDK without
 * buffering in server memory, regardless of file size.
 *
 * Assumptions (v0):
 * - Credentials come from the in-memory per-user S3 connection config
 *   (same as download/preview). No production credential vaulting.
 * - No server-side file size limit is enforced; S3's 5 TB object limit applies.
 * - A single Content-Type header value is trusted from the client and forwarded
 *   to S3 as-is.
 */
export const POST: RequestHandler = async ({ locals, url, request }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const { bucket, key } = requireBucketKey(url);

  const contentType = (request.headers.get('Content-Type') ?? 'application/octet-stream')
    .split(';')[0]
    .trim();

  const rawLength = request.headers.get('Content-Length');
  const contentLength = rawLength ? parseInt(rawLength, 10) : undefined;

  // An empty file (0 bytes) may arrive with a null body — this is valid.
  if (!request.body && contentLength !== 0) {
    throw error(400, 'Missing request body');
  }

  const body = request.body ?? Buffer.alloc(0);

  log.debug(
    { bucket, key, content_type: contentType, content_length: contentLength },
    'upload request received'
  );

  await uploadObject(userId, bucket, key, body, contentType, contentLength);

  log.info(
    { bucket, key, content_type: contentType, content_length: contentLength },
    'upload completed'
  );

  return new Response(null, { status: 201 });
};
