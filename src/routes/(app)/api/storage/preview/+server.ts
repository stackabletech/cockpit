import { error } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { mapS3ErrorToHttp } from '$lib/server/storage/s3-errors.js';
import { getParquetPreview } from '$lib/server/storage/preview/parquet';
import { getCsvPreview } from '$lib/server/storage/preview/csv';
import { binaryPreview, KNOWN_BINARY_TYPES } from '$lib/server/storage/preview/binary.js';
import { streamPreview } from '$lib/server/storage/preview/stream.js';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { infiniteScrollEnabled, filePreviewRows } from '$lib/server/feature-flags';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/preview?bucket=<bucket>&key=<object-key>
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const key = event.url.searchParams.get('key')?.trim();
  if (!key) throw error(400, 'Missing required query parameter: key');
  const { url, locals } = event;
  const log = locals.logger;

  try {
    const metadata = await provider.getMetadata(key);
    const rawContentType = metadata.contentType ?? 'application/octet-stream';
    const totalSize = metadata.size;
    const lowerKey = key.toLowerCase();

    // Parquet files (by content-type or extension) — parse server-side and emit structured preview rows.
    const isParquet =
      rawContentType === 'application/vnd.apache.parquet' ||
      rawContentType === 'application/x-parquet' ||
      lowerKey.endsWith('.parquet');

    let offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    let limit = parseInt(url.searchParams.get('limit') ?? '250', 10);
    const includeData = url.searchParams.get('data') === 'true';

    // When infinite scroll is disabled, restrict to the first page only (no chunked loading)
    if (!infiniteScrollEnabled) {
      offset = 0;
      limit = Math.min(limit, filePreviewRows);
    }

    if (isParquet) {
      return await getParquetPreview(provider, key, offset, limit, log, totalSize, includeData);
    }

    // Skip body fetch for known-binary formats — client will show fallback immediately.
    if (KNOWN_BINARY_TYPES.has(rawContentType)) {
      log.info(
        { bucket, key, content_type: rawContentType },
        'skipping preview fetch for known-binary type'
      );
      return binaryPreview(rawContentType, totalSize);
    }

    // Normalise the content-type for Excel-exported CSV/TSV files so the client
    // treats them as text/csv or text/tab-separated-values rather than binary.
    let contentType = rawContentType;
    if (rawContentType === 'application/vnd.ms-excel') {
      if (lowerKey.endsWith('.csv')) contentType = 'text/csv';
      else if (lowerKey.endsWith('.tsv')) contentType = 'text/tab-separated-values';
    }

    // CSV files — use row-based NDJSON streaming (regardless of flag, so the
    // client always receives structured data). The offset/limit cap above
    // restricts chunked loading when the feature is disabled.
    const isCsv =
      contentType === 'text/csv' ||
      contentType === 'application/csv' ||
      contentType === 'text/tab-separated-values' ||
      lowerKey.endsWith('.csv') ||
      lowerKey.endsWith('.tsv');

    if (isCsv) {
      return await getCsvPreview(
        provider,
        key,
        offset,
        limit,
        contentType,
        totalSize,
        log,
        includeData
      );
    }

    // Pass a placeholder user identifier for logging purposes (no longer user-specific)
    return await streamPreview(provider, key, contentType, totalSize, 'client', log);
  } catch (err) {
    if (err instanceof S3ServiceException) {
      mapS3ErrorToHttp(err, { bucket, key, operation: 'preview' });
    }
    throw err;
  }
};
