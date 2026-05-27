import { S3ServiceException } from '@aws-sdk/client-s3';
import { getUserId } from '$lib/server/auth-utils.js';
import { mapS3ErrorToHttp } from '$lib/server/storage/s3-errors.js';
import { getProviderForUser } from '$lib/server/storage/utils.js';
// import { parquetPreview } from '$lib/server/storage/preview/parquet.js';
import { binaryPreview, KNOWN_BINARY_TYPES } from '$lib/server/storage/preview/binary.js';
import { streamPreview } from '$lib/server/storage/preview/stream.js';
import { requireBucketKey } from '../params.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const { bucket, key } = requireBucketKey(url);

  const provider = getProviderForUser(userId, bucket);

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
        'parquet preview disabled'
      );
      // TODO: re-enable once we have a more robust parquet preview solution in place
      // return await parquetPreview(provider, key, totalSize, userId, log);
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
      mapS3ErrorToHttp(err, { bucket, key, operation: 'preview' });
    }
    throw err;
  }
};
