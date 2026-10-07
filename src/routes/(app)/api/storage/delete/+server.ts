import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { DeleteObjectsBodySchema } from '$lib/storage/schemas.js';

/**
 * DELETE /api/storage/delete?bucket=<bucket>
 *
 * Deletes one or more objects from the storage bucket. The request body must
 * be JSON: `{ keys: string[] }`. Returns the deletion result including any failures.
 */
export const DELETE: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const body = DeleteObjectsBodySchema.safeParse(await event.request.json().catch(() => null));
  const log = event.locals.logger;
  if (!body.success) throw error(400, 'Invalid request body');
  const { keys } = body.data;

  log.debug({ bucket, key_count: keys.length }, 'delete request received');

  const result = await provider.deleteObjects(keys);

  log.info(
    { bucket, key_count: keys.length, failed_count: result.failed.length },
    'objects delete completed'
  );

  return Response.json(result);
};
