import { error } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { getUserId } from '$lib/server/auth-utils.js';
import { listObjects } from '$lib/server/storage/service.js';
import { requireBucket } from '../params.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const bucket = requireBucket(url);

  try {
    await listObjects(userId, bucket, '', 1);
    log.debug({ user_id: userId, bucket }, 'bucket access check passed');
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const status = err.$metadata?.httpStatusCode;
      const code = err.name;
      log.info({ user_id: userId, bucket, s3_code: code, status }, 'bucket access check failed');

      if (code === 'NoSuchBucket' || status === 404) {
        throw error(404, 'Bucket not found');
      }
      if (code === 'AccessDenied' || status === 403) {
        throw error(403, 'Access denied');
      }
    }
    log.warn({ err, user_id: userId, bucket }, 'unexpected error during bucket access check');
    throw error(502, 'Could not reach bucket');
  }
};
