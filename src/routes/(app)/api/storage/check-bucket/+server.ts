import { error, isHttpError } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/check-bucket?bucket=<bucket>
 *
 * Verifies that the configured bucket is reachable and accessible.
 * Returns 204 on success, 502 if the bucket cannot be reached.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);

  try {
    await provider.listObjects('', 1);
    event.locals.logger.debug({ bucket }, 'bucket access check passed');
    return new Response(null, { status: 204 });
  } catch (err) {
    if (isHttpError(err)) throw err;
    event.locals.logger.warn({ err, bucket }, 'unexpected error during bucket access check');
    throw error(502, 'Could not reach bucket');
  }
};
