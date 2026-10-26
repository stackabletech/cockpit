import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStorageProvider } from '$lib/server/storage/request-context.js';

/**
 * DELETE /api/storage/delete?bucket=<bucket>&keys=<key1>&keys=<key2>[&trash=true]
 *
 * Deletes one or more objects from the storage bucket. Each key is passed as a
 * repeated `keys` query parameter. With `trash=true`, backends with an enabled
 * trash (HDFS) move the keys there instead. Returns the deletion result
 * including any failures and the number of trashed keys.
 */
export const DELETE: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const keys = event.url.searchParams.getAll('keys');
  const useTrash = event.url.searchParams.get('trash') === 'true';
  const log = event.locals.logger;

  if (!keys.length) throw error(400, 'Missing required parameter: keys');

  log.debug({ bucket, key_count: keys.length, use_trash: useTrash }, 'delete request received');

  const result = await provider.deleteObjects(keys, { useTrash });

  log.info(
    {
      bucket,
      key_count: keys.length,
      failed_count: result.failed.length,
      trashed_count: result.trashed ?? 0
    },
    'objects delete completed'
  );

  return Response.json(result);
};
