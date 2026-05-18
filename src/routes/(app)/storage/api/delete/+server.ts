import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { deleteObjects } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';

/**
 * DELETE /storage/api/delete?bucket=<bucket>&keys=<key1>&keys=<key2>&...
 *
 * Deletes one or more S3 objects from the given bucket.
 * Authentication is enforced by the app-level auth guard in hooks.server.ts.
 */
export const DELETE: RequestHandler = async ({ locals, url }) => {
  const bucket = url.searchParams.get('bucket');
  if (!bucket || !bucket.trim()) {
    throw error(400, 'Missing required query parameter: bucket');
  }

  const keys = url.searchParams.getAll('keys');
  if (!keys.length) {
    throw error(400, 'Missing required query parameter: keys');
  }

  const userId = getUserId(locals);

  locals.logger.debug({ bucket, key_count: keys.length }, 'delete request received');

  const result = await deleteObjects(userId, bucket, keys);

  locals.logger.info(
    { bucket, key_count: keys.length, failed_count: result.failed.length },
    'objects delete completed'
  );

  return Response.json(result);
};
