import { error, json } from '@sveltejs/kit';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { getUserId } from '$lib/server/auth-utils.js';
import { getConnection } from '$lib/server/storage/service.js';
import { StorageProviderFactory } from '$lib/server/storage/factory.js';
import type { RequestHandler } from '@sveltejs/kit';

/** Maximum bytes fetched for text-based previews (256 KiB). */
const TEXT_PREVIEW_BYTES = 256 * 1024;
/** Maximum bytes fetched for image previews (5 MiB). */
const IMAGE_PREVIEW_BYTES = 5 * 1024 * 1024;
/** Maximum bytes fetched for PDF previews (25 MiB). */
const PDF_PREVIEW_BYTES = 25 * 1024 * 1024;

/**
 * Content types that are definitively binary and cannot be rendered as text.
 * For these we skip the body fetch entirely and tell the client upfront.
 */
const KNOWN_BINARY_TYPES = new Set([
  'application/gzip',
  'application/x-gzip',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-tar',
  'application/x-bzip2',
  'application/x-xz',
  'application/x-zstd',
  'application/zstd',
  'application/vnd.apache.parquet',
  'application/x-parquet',
  'application/avro',
  'application/x-avro',
  'application/orc',
  'application/x-orc',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

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
    const contentType = metadata.contentType ?? 'application/octet-stream';
    const totalSize = metadata.size;

    // Skip body fetch for known-binary formats — client will show fallback immediately.
    if (KNOWN_BINARY_TYPES.has(contentType)) {
      log.info(
        { user_id: userId, bucket, key, content_type: contentType },
        'skipping preview fetch for known-binary type'
      );
      return new Response(null, {
        headers: {
          'Content-Type': contentType,
          'X-Preview-Renderable': 'false',
          'X-Preview-Total-Size': String(totalSize),
          'X-Preview-Bytes': '0',
          'X-Preview-Truncated': 'false',
          'Cache-Control': 'no-store'
        }
      });
    }

    let limitBytes: number;
    if (contentType.startsWith('image/')) {
      limitBytes = IMAGE_PREVIEW_BYTES;
    } else if (contentType === 'application/pdf') {
      limitBytes = PDF_PREVIEW_BYTES;
    } else {
      limitBytes = TEXT_PREVIEW_BYTES;
    }

    const previewBytes = Math.min(totalSize, limitBytes);
    const truncated = previewBytes < totalSize;

    log.info(
      {
        user_id: userId,
        bucket,
        key,
        content_type: contentType,
        preview_bytes: previewBytes,
        truncated
      },
      'fetching object preview'
    );

    const stream =
      previewBytes === totalSize
        ? await provider.getObject(key)
        : await provider.getObjectRange(key, 0, previewBytes - 1);

    return new Response(stream as ReadableStream, {
      headers: {
        'Content-Type': contentType,
        'X-Preview-Renderable': 'true',
        'X-Preview-Truncated': String(truncated),
        'X-Preview-Total-Size': String(totalSize),
        'X-Preview-Bytes': String(previewBytes),
        'Cache-Control': 'no-store'
      }
    });
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
