import { error } from '@sveltejs/kit';
import { ArchiveCacheFullError, listArchiveContents } from '$lib/server/storage/archive.js';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireObjectKey } from '$lib/server/storage/request-context.js';
import { withStorageHttpErrors } from '$lib/server/storage/wrap-provider.js';
import { archivePreviewMaxBytes } from '$lib/server/storage/config.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/archive/listing?bucket=<bucket>&key=<archive-key>&internalPrefix=<path>&nestedArchivePath=<path>
 *
 * Lists the contents of an archive file at the given internal path.
 * Supports nested archives via the optional `nestedArchivePath` parameter:
 * when set, the server extracts the nested archive from the outer one first.
 *
 * The archive is downloaded from S3 and cached server-side until its ETag
 * changes, for at most 30 minutes, so that subsequent navigations within the
 * same archive only cost a HEAD request.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const GET: RequestHandler = async (event) => {
  const { locals, url } = event;
  const bucket = url.searchParams.get('bucket')?.trim();
  if (!bucket) throw error(400, 'Missing required query parameter: bucket');

  const key = requireObjectKey(event);

  const internalPrefix = url.searchParams.get('internalPrefix') ?? '';
  const nestedArchivePath = url.searchParams.get('nestedArchivePath')?.trim() || undefined;

  const config = locals.storageConfig;
  const connectionId = locals.storageConnectionId;
  if (!config || !connectionId) {
    throw error(401, 'No storage connection configured');
  }

  locals.logger.debug(
    { bucket, key, internal_prefix: internalPrefix, nested_archive_path: nestedArchivePath },
    'listing archive contents'
  );

  const provider = withStorageHttpErrors(getProvider(config, bucket));
  const downloadFn = (k: string) => provider.getObject(k);
  const metadataFn = (k: string) => provider.getMetadata(k);

  let listing;
  try {
    listing = await listArchiveContents(bucket, key, internalPrefix, downloadFn, metadataFn, {
      nestedArchivePath,
      maxBytes: archivePreviewMaxBytes,
      connectionId,
      signal: event.request.signal
    });
  } catch (err) {
    if (err instanceof ArchiveCacheFullError) {
      throw error(503, 'Archive preview is busy, please try again later');
    }
    // The client went away; there is nobody to answer.
    if (event.request.signal.aborted) return new Response(null, { status: 499 });
    throw err;
  }
  return Response.json(listing);
};
