import { error, isHttpError } from '@sveltejs/kit';
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
    if (isHttpError(err)) {
      log.info({ user_id: userId, bucket, status: err.status }, 'bucket access check failed');
      throw err;
    }
    log.warn({ err, user_id: userId, bucket }, 'unexpected error during bucket access check');
    throw error(502, 'Could not reach bucket');
  }
};
