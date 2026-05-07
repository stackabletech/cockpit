import { S3Client, ListBucketsCommand, S3ServiceException } from '@aws-sdk/client-s3';
import { error } from '@sveltejs/kit';
import { getUserConnection, setUserConnection, clearUserConnection } from './user-connections.js';
import { StorageProviderFactory } from './factory.js';
import type { S3ConnectionConfig } from './types.js';
import type { StoragePage } from '$lib/storage/types.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-service' });

export { getUserConnection as getConnection };
export { setUserConnection as saveConnection };
export { clearUserConnection as clearConnection };

/** List all buckets accessible with the user's current connection. Returns [] when not connected. */
export async function listBuckets(userId: string): Promise<string[]> {
  const config = getUserConnection(userId);
  if (!config) return [];

  const client = new S3Client({
    region: config.region,
    ...(config.endpoint && {
      endpoint: config.endpoint,
      forcePathStyle: true
    }),
    ...(config.accessKeyId &&
      config.secretAccessKey && {
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      })
  });

  const output = await client.send(new ListBucketsCommand({}));
  const buckets = (output.Buckets ?? []).map((b) => b.Name ?? '').filter(Boolean);
  log.debug({ user_id: userId, bucket_count: buckets.length }, 'listed buckets');
  return buckets;
}

/** List objects at the given bucket/prefix for the user's current connection. Throws on S3 errors. */
export async function listObjects(
  userId: string,
  bucket: string,
  prefix: string,
  pageSize: number,
  continuationToken?: string | null
): Promise<StoragePage> {
  const connection = getUserConnection(userId);

  if (!connection) {
    throw error(401, 'No storage connection configured');
  }

  if (connection.type !== 's3') {
    throw error(400, 'Storage backend not supported');
  }

  const provider = StorageProviderFactory.create({ ...connection, bucket });

  try {
    return await provider.listObjects(prefix, pageSize, continuationToken ?? undefined);
  } catch (err) {
    if (err instanceof S3ServiceException) {
      const code = err.name;
      log.warn({ user_id: userId, bucket, prefix, error_code: code }, 'S3 error listing objects');

      if (code === 'AccessDenied' || err.$metadata?.httpStatusCode === 403) {
        throw error(403, `Access denied to bucket "${bucket}"`);
      }
      if (code === 'NoSuchBucket' || err.$metadata?.httpStatusCode === 404) {
        throw error(404, `Bucket "${bucket}" not found`);
      }
      throw error(502, `Storage error: ${err.message}`);
    }
    throw err;
  }
}

export type { S3ConnectionConfig };
