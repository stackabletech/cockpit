import { json } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { uploadObject } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';
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

  const bucket = url.searchParams.get('bucket');
  if (!bucket || !bucket.trim()) {
    return json(
      { error: 'Missing required query parameter: bucket', code: 'invalid_request' },
      { status: 400 }
    );
  }

  const key = url.searchParams.get('key');
  if (!key || !key.trim()) {
    return json(
      { error: 'Missing required query parameter: key', code: 'invalid_request' },
      { status: 400 }
    );
  }

  const contentType = (request.headers.get('Content-Type') ?? 'application/octet-stream')
    .split(';')[0]
    .trim();

  const rawLength = request.headers.get('Content-Length');
  const contentLength = rawLength ? parseInt(rawLength, 10) : undefined;

  if (!request.body) {
    return json({ error: 'Missing request body', code: 'invalid_request' }, { status: 400 });
  }

  log.debug(
    { bucket, key, content_type: contentType, content_length: contentLength },
    'upload request received'
  );

  try {
    await uploadObject(userId, bucket, key, request.body, contentType, contentLength);
    log.info(
      { bucket, key, content_type: contentType, content_length: contentLength },
      'upload completed'
    );
    return json({ success: true }, { status: 201 });
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const code = err.name;
      const httpStatus = err.$metadata?.httpStatusCode;

      log.warn(
        { bucket, key, error_code: code, http_status: httpStatus },
        'S3 error during upload'
      );

      if (code === 'AccessDenied' || httpStatus === 403) {
        return json(
          {
            error: 'Access denied. You do not have permission to upload here.',
            code: 'access_denied'
          },
          { status: 403 }
        );
      }
      if (code === 'NoSuchBucket' || httpStatus === 404) {
        return json(
          { error: `Bucket "${bucket}" does not exist.`, code: 'no_such_bucket' },
          { status: 404 }
        );
      }
      if (code === 'InvalidPart' || code === 'InvalidPartOrder' || code === 'EntityTooSmall') {
        return json(
          { error: 'Upload failed due to a data integrity error.', code: 'invalid_part' },
          { status: 400 }
        );
      }
      return json(
        { error: `Storage error: ${err.message}`, code: 'server_error' },
        { status: 502 }
      );
    }

    log.error({ bucket, key, err }, 'unexpected error during upload');
    return json(
      { error: 'An unexpected error occurred during upload.', code: 'unknown' },
      { status: 500 }
    );
  }
};
