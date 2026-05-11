import { error, json } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { getUserId } from '$lib/server/auth-utils.js';
import { getConnection } from '$lib/server/storage/service.js';
import { StorageProviderFactory } from '$lib/server/storage/factory.js';
import { parquetPreview } from '$lib/server/storage/preview/parquet.js';
import { binaryPreview, KNOWN_BINARY_TYPES } from '$lib/server/storage/preview/binary.js';
import { streamPreview } from '$lib/server/storage/preview/stream.js';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);

  const bucket = url.searchParams.get('bucket');
  const key = url.searchParams.get('key');

  if (!bucket || !key) {
    return json({ error: 'Missing bucket or key parameter' }, { status: 400 });
  }

  const connection = getConnection(userId);
  if (!connection) {
    return json({ error: 'No storage connection configured' }, { status: 401 });
  }
  if (connection.type !== 's3') {
    return json({ error: 'Storage backend not supported for preview' }, { status: 400 });
  }

  const provider = StorageProviderFactory.create({ ...connection, bucket });

  try {
    const metadata = await provider.getMetadata(key);
    const rawContentType = metadata.contentType ?? 'application/octet-stream';
    const totalSize = metadata.size;
    const lowerKey = key.toLowerCase();

    // Parquet files (by content-type or extension) — parse server-side and emit CSV rows.
    const isParquet =
      rawContentType === 'application/vnd.apache.parquet' ||
      rawContentType === 'application/x-parquet' ||
      lowerKey.endsWith('.parquet');

    if (isParquet) {
      log.info(
        { user_id: userId, bucket, key, content_type: rawContentType, total_size: totalSize },
        'parsing parquet preview'
      );
      return await parquetPreview(provider, key, totalSize, userId, log);
    }

    // Skip body fetch for known-binary formats — client will show fallback immediately.
    if (KNOWN_BINARY_TYPES.has(rawContentType)) {
      log.info(
        { user_id: userId, bucket, key, content_type: rawContentType },
        'skipping preview fetch for known-binary type'
      );
      return binaryPreview(rawContentType, totalSize);
    }

    // Normalise the content-type for Excel-exported CSV files so the client
    // treats them as text/csv rather than binary.
    const contentType =
      rawContentType === 'application/vnd.ms-excel' && lowerKey.endsWith('.csv')
        ? 'text/csv'
        : rawContentType;

    return await streamPreview(provider, key, contentType, totalSize, userId, log);
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const code = err.name;
      const status = err.$metadata?.httpStatusCode;
      log.warn(
        { user_id: userId, bucket, key, error_code: code, http_status: status },
        'S3 error fetching preview'
      );
      if (code === 'AccessDenied' || status === 403) {
        throw error(403, 'Access denied');
      }
      if (code === 'NoSuchKey' || status === 404) {
        throw error(404, 'Object not found');
      }
      throw error(502, `Storage error: ${err.message}`);
    }
    throw err;
  }
};
