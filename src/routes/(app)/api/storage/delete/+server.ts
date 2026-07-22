import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStorageProvider } from '$lib/server/storage/request-context.js';

/**
 * DELETE /api/storage/delete?bucket=<bucket>&keys=<key1>&keys=<key2>
 *
 * Deletes one or more objects from the storage bucket. Each key is passed as a
 * repeated `keys` query parameter. Returns the deletion result including any
 * failures.
 */
export const DELETE: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const keys = event.url.searchParams.getAll('keys');
  const log = event.locals.logger;

  if (!keys.length) throw error(400, 'Missing required parameter: keys');

  log.debug({ bucket, key_count: keys.length }, 'delete request received');

  const result = await provider.deleteObjects(keys);

  log.info(
    { bucket, key_count: keys.length, failed_count: result.failed.length },
    'objects delete completed'
  );

  return Response.json(result);
};
