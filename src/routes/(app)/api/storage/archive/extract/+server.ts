import { error } from '@sveltejs/kit';
import { guessContentType } from '$lib/server/storage/content-type.js';
import {
  archiveCacheScope,
  extractArchiveEntry,
  getArchiveFormat
} from '$lib/server/storage/archive.js';
import { getProvider } from '$lib/server/storage/utils.js';
import { wrapProvider } from '$lib/server/storage/wrap-provider.js';
import { archivePreviewMaxBytes } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';

/**
 * GET /api/storage/archive/extract?bucket=<bucket>&key=<archive-key>&path=<internal-path>&nestedArchivePath=<path>
 *
 * Extracts a single file from an archive and returns it as a stream.
 * Supports nested archives: when `nestedArchivePath` is set, the file is
 * extracted from within a nested archive inside the outer one.
 *
 * The archive is downloaded from S3 once and cached server-side, so multiple
 * extractions from the same archive share a single S3 transfer.
 *
 * Returns 404 if the internal path does not exist in the archive or if the
 * archive exceeds the configured preview size limit.
 * Returns 400 if the archive is not a supported format.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const GET: RequestHandler = async ({ locals, url, request }) => {
  const bucket = url.searchParams.get('bucket')?.trim();
  if (!bucket) throw error(400, 'Missing required query parameter: bucket');

  const key = url.searchParams.get('key')?.trim();
  if (!key) throw error(400, 'Missing required query parameter: key');

  const internalPath = url.searchParams.get('path')?.trim();
  if (!internalPath) throw error(400, 'Missing required query parameter: path');

  const nestedArchivePath = url.searchParams.get('nestedArchivePath')?.trim() || undefined;

  const format = getArchiveFormat(key);
  if (!format) {
    throw error(400, `Unsupported archive format: ${key}`);
  }

  const config = locals.storageConfig;
  if (!config) {
    throw error(401, 'No storage connection configured');
  }

  locals.logger.debug(
    { bucket, key, internal_path: internalPath, nested_archive_path: nestedArchivePath, format },
    'extracting archive entry'
  );

  const downloadFn = (k: string) =>
    wrapProvider(getProvider(config, bucket))
      .getObject(k)
      .then((d) => d.stream);
  const metadataFn = (k: string) => wrapProvider(getProvider(config, bucket)).getMetadata(k);

  const data = await extractArchiveEntry(
    archiveCacheScope(request.headers.get(STORAGE_CONNECTION_ID_HEADER) ?? '', bucket),
    key,
    internalPath,
    downloadFn,
    metadataFn,
    nestedArchivePath,
    archivePreviewMaxBytes
  );

  if (!data) {
    throw error(404, `File "${internalPath}" not found in archive`);
  }

  const contentType = guessContentType(internalPath);

  return new Response(data as BodyInit, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, no-store'
    }
  });
};
