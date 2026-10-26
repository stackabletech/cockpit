import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { TrashInfo } from '$lib/storage/types.js';

const NO_TRASH: TrashInfo = { enabled: false, intervalMinutes: 0 };

/**
 * GET /api/storage/trash?bucket=<bucket>
 *
 * Reports whether deletes on this connection can go to a trash (HDFS with
 * `fs.trash.interval` > 0), so the delete dialog can offer it.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const info = provider.getTrashInfo ? await provider.getTrashInfo() : NO_TRASH;
  event.locals.logger.debug(
    { bucket, trash_enabled: info.enabled, trash_interval_minutes: info.intervalMinutes },
    'trash info requested'
  );
  return json(info);
};
