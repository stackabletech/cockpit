import { error } from '@sveltejs/kit';
import { extractArchiveEntry, getArchiveFormat } from '$lib/server/storage/archive.js';
import { getProvider } from '$lib/server/storage/utils.js';
import { archivePreviewMaxBytes } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';

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
export const GET: RequestHandler = async ({ locals, url }) => {
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
    getProvider(config, bucket)
      .getObject(k)
      .then((d) => d.stream);
  const metadataFn = (k: string) => getProvider(config, bucket).getMetadata(k);

  const data = await extractArchiveEntry(
    bucket,
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

function guessContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const mime: Record<string, string> = {
    txt: 'text/plain',
    csv: 'text/csv',
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    md: 'text/markdown',
    yaml: 'application/x-yaml',
    yml: 'application/x-yaml',
    parquet: 'application/octet-stream',
    pdf: 'application/pdf',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    log: 'text/plain',
    py: 'text/plain',
    java: 'text/plain',
    ts: 'text/plain',
    sql: 'text/plain'
  };
  return mime[ext] ?? 'application/octet-stream';
}
