import { error, isHttpError } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const bucket = requireBucket(url);

  try {
    await getProvider(locals.storageConfig!, bucket).listObjects('', 1);
    log.debug({ bucket }, 'bucket access check passed');
    return new Response(null, { status: 204 });
  } catch (err) {
    if (isHttpError(err)) {
      log.info({ bucket, status: err.status }, 'bucket access check failed');
      throw err;
    }
    log.warn({ err, bucket }, 'unexpected error during bucket access check');
    throw error(502, 'Could not reach bucket');
  }
};
