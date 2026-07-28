import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { DirectoryMetadata } from '$lib/storage/details-types.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/directory-metadata?bucket=<bucket>&prefix=<prefix>
 *
 * Returns metadata for a directory, including the bucket ACL and, if present,
 * the directory marker object's metadata.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const prefix = event.url.searchParams.get('prefix')?.trim();
  if (!prefix) throw error(400, 'Missing required query parameter: prefix');

  event.locals.logger.debug({ bucket, prefix }, 'fetching directory metadata');

  const acl = await provider.getBucketAcl();
  const result: DirectoryMetadata = {
    bucketOwner: acl.owner,
    bucketGrants: acl.grants,
    markerExists: false
  };

  try {
    const meta = await provider.getMetadata(prefix);
    result.markerExists = true;
    result.markerLastModified = meta.lastModified.toISOString();
    result.markerContentType = meta.contentType;
    result.markerETag = meta.etag;
    result.markerContentLength = meta.size;
    result.markerVersionId = meta.versionId;
    result.markerStorageClass = meta.storageClass;
    result.markerIsDeleteMarker = meta.isDeleteMarker;
    result.markerCustomMetadata = meta.customMetadata;
  } catch {
    // No directory marker object — that's fine
  }

  return Response.json(result);
};
