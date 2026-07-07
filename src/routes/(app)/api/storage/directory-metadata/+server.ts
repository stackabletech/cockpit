import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';
import type { DirectoryMetadata } from '$lib/storage/details-types.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const bucket = requireBucket(url);
  const prefix = url.searchParams.get('prefix')?.trim();

  if (!prefix) {
    throw error(400, 'Missing required query parameter: prefix');
  }

  locals.logger.debug({ bucket, prefix }, 'fetching directory metadata');

  const provider = getProvider(locals.storageConfig!, bucket);

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

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' }
  });
};
