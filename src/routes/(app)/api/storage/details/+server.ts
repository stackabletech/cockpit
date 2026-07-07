import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucketKey } from '../params.js';
import type { FileDetails } from '$lib/storage/details-types.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const { bucket, key } = requireBucketKey(url);

  locals.logger.debug({ bucket, key }, 'fetching object details');

  const provider = getProvider(locals.storageConfig!, bucket);
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
