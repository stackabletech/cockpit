import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';

/**
 * DELETE /api/storage/delete?bucket=<bucket>&keys=<key1>&keys=<key2>&...
 *
 * Deletes one or more S3 objects from the given bucket.
 * Authentication is enforced by the app-level auth guard in hooks.server.ts.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const DELETE: RequestHandler = async ({ locals, url }) => {
  const bucket = requireBucket(url);

  const keys = url.searchParams.getAll('keys');
  if (!keys.length) {
    throw error(400, 'Missing required query parameter: keys');
  }

  locals.logger.debug({ bucket, key_count: keys.length }, 'delete request received');

  const result = await getProvider(locals.storageConfig!, bucket).deleteObjects(keys);

  locals.logger.info(
    { bucket, key_count: keys.length, failed_count: result.failed.length },
    'objects delete completed'
  );

  return Response.json(result);
};
