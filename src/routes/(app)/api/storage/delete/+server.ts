import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStorageProvider } from '$lib/server/storage/request-context.js';

/**
 * DELETE /api/storage/delete?bucket=<bucket>
 *
 * Deletes one or more objects from the storage bucket. The request body must
 * be JSON: `{ keys: string[] }`. Returns the deletion result including any failures.
 */
export const DELETE: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const { keys } = (await event.request.json()) as { keys?: string[] };
  const log = event.locals.logger;

  if (!keys?.length) throw error(400, 'Missing required body field: keys');

  log.debug({ bucket, key_count: keys.length }, 'delete request received');

  const result = await provider.deleteObjects(keys);

  log.info(
    { bucket, key_count: keys.length, failed_count: result.failed.length },
    'objects delete completed'
  );

  return Response.json(result);
};
