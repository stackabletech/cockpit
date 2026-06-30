import { error } from '@sveltejs/kit';
import { listArchiveContents } from '$lib/server/storage/archive.js';
import { downloadObject, getObjectMetadata } from '$lib/server/storage/service.js';
import { archivePreviewMaxMB } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';

const archivePreviewMaxBytes = archivePreviewMaxMB * 1024 * 1024;

/**
 * GET /api/storage/archive/listing?bucket=<bucket>&key=<archive-key>&internalPrefix=<path>&nestedArchivePath=<path>
 *
 * Lists the contents of an archive file at the given internal path.
 * Supports nested archives via the optional `nestedArchivePath` parameter:
 * when set, the server extracts the nested archive from the outer one first.
 *
 * The archive is downloaded from S3 and cached server-side for 30 minutes
 * so that subsequent navigations within the same archive do not incur
 * additional S3 transfer costs.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
  const bucket = url.searchParams.get('bucket')?.trim();
  if (!bucket) throw error(400, 'Missing required query parameter: bucket');

  const key = url.searchParams.get('key')?.trim();
  if (!key) throw error(400, 'Missing required query parameter: key');

  const internalPrefix = url.searchParams.get('internalPrefix') ?? '';
  const nestedArchivePath = url.searchParams.get('nestedArchivePath')?.trim() || undefined;

  locals.logger.debug(
    { bucket, key, internal_prefix: internalPrefix, nested_archive_path: nestedArchivePath },
    'listing archive contents'
  );

  const downloadFn = (k: string) =>
    downloadObject(locals.storageConfig!, bucket, k).then((d) => d.stream);
  const metadataFn = (k: string) => getObjectMetadata(locals.storageConfig!, bucket, k);

  const listing = await listArchiveContents(
    bucket,
    key,
    internalPrefix,
    downloadFn,
    metadataFn,
    nestedArchivePath,
    archivePreviewMaxBytes
  );
  return Response.json(listing);
};
