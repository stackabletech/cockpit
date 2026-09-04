import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { FileDetails } from '$lib/storage/details-types.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/details?bucket=<bucket>&key=<object-key>
 *
 * Returns the full metadata for a single storage object.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const key = event.url.searchParams.get('key')?.trim();
  if (!key) throw error(400, 'Missing required query parameter: key');

  event.locals.logger.debug({ bucket, key }, 'fetching object details');

  const meta = await provider.getMetadata(key);

  const details: FileDetails = {
    key,
    name: key.split('/').filter(Boolean).pop() ?? key,
    size: meta.size,
    lastModified: meta.lastModified,
    contentType: meta.contentType,
    etag: meta.etag,
    customMetadata: meta.customMetadata,
    versionId: meta.versionId,
    storageClass: meta.storageClass,
    isDeleteMarker: meta.isDeleteMarker ?? false
  };

  return Response.json(details);
};
