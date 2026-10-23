import { error } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { mapS3ErrorToHttp } from '$lib/server/storage/s3-errors.js';
import { getParquetPreview } from '$lib/server/storage/preview/parquet';
import { getCsvPreview } from '$lib/server/storage/preview/csv';
import { binaryPreview, KNOWN_BINARY_TYPES } from '$lib/server/storage/preview/binary.js';
import { streamPreview } from '$lib/server/storage/preview/stream.js';
import { createStorageProvider, requireObjectKey } from '$lib/server/storage/request-context.js';
import { infiniteScrollEnabled } from '$lib/server/feature-flags';
import { filePreviewRows } from '$lib/server/storage/config.js';
import { PREVIEW_CHUNK_ROWS } from '$lib/storage/types.js';
import type { RequestHandler } from './$types';

/** Upper bound for rows returned by a single preview request. Applies whether
 *  or not infinite scroll is enabled, so one request can never ask the server
 *  to decode an unbounded number of rows. Never below the client chunk size. */
const maxPreviewRowsPerRequest = Math.max(filePreviewRows, PREVIEW_CHUNK_ROWS);

const previewRangeSchema = z.object({
  offset: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(maxPreviewRowsPerRequest)
    .default(PREVIEW_CHUNK_ROWS)
});

/**
 * GET /api/storage/preview?bucket=<bucket>&key=<object-key>
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const key = requireObjectKey(event);
  const { url, locals } = event;
  const log = locals.logger;

  const range = previewRangeSchema.safeParse({
    offset: url.searchParams.get('offset') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined
  });
  if (!range.success) {
    log.warn(
      {
        bucket,
        key,
        offset: url.searchParams.get('offset'),
        limit: url.searchParams.get('limit'),
        max_limit: maxPreviewRowsPerRequest
      },
      'rejected preview request with invalid row range'
    );
    throw error(
      400,
      `offset must be a non-negative integer and limit an integer between 1 and ${maxPreviewRowsPerRequest}`
    );
  }
  let { offset, limit } = range.data;

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

    const includeData = url.searchParams.get('data') === 'true';

    // When infinite scroll is disabled, restrict to the first page only (no chunked loading)
    if (!infiniteScrollEnabled) {
      offset = 0;
      limit = Math.min(limit, filePreviewRows);
    }

    if (isParquet) {
      return await getParquetPreview(
        provider,
        key,
        offset,
        limit,
        log,
        metadata,
        includeData,
        bucket,
        locals.storageConnectionId ?? ''
      );
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

    // CSV files use row-based NDJSON streaming. TSV is deliberately handled by
    // the text preview below so CsvPreview can parse its tab delimiter directly.
    const isCsv =
      contentType === 'text/csv' || contentType === 'application/csv' || lowerKey.endsWith('.csv');

    if (isCsv) {
      return await getCsvPreview(
        provider,
        key,
        offset,
        limit,
        totalSize,
        log,
        includeData,
        bucket,
        locals.storageConnectionId ?? ''
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
