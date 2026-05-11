import { S3ServiceException, ListBucketsCommand } from '@aws-sdk/client-s3';
import { getUserConnection, setUserConnection, clearUserConnection } from './user-connections.js';
import type { S3ConnectionConfig } from './types.js';
import { createS3Client } from './s3-client.js';
import { mapS3ErrorToHttp } from './s3-errors.js';
import { getProviderForUser } from './utils.js';
import type { StoragePage, StorageMetadata } from '$lib/storage/types.js';
import type { ObjectDownload } from './provider.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-service' });

export { getUserConnection as getConnection };
export { setUserConnection as saveConnection };
export { clearUserConnection as clearConnection };

/** List all buckets accessible with the user's current connection. Returns [] when not connected. */
export async function listBuckets(userId: string): Promise<string[]> {
  const config = getUserConnection(userId);
  if (!config) return [];

  const client = createS3Client(config);

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
  const provider = getProviderForUser(userId, bucket);

  try {
    return await provider.listObjects(prefix, pageSize, continuationToken ?? undefined);
  } catch (err) {
    if (err instanceof S3ServiceException) {
      mapS3ErrorToHttp(err, { bucket, operation: 'listObjects' });
    }
    throw err;
  }
}
/** Download a single object from the bucket, returning a stream and metadata for the HTTP response. */
export async function downloadObject(
  userId: string,
  bucket: string,
  key: string
): Promise<ObjectDownload> {
  const provider = getProviderForUser(userId, bucket);

  try {
    log.debug({ user_id: userId, bucket, key }, 'downloading object');
    const download = await provider.getObject(key);
    log.info({ user_id: userId, bucket, key }, 'object download started');
    return download;
  } catch (err) {
    if (err instanceof S3ServiceException) {
      mapS3ErrorToHttp(err, { bucket, key, operation: 'getObject' });
    }
    throw err;
  }
}

/** Fetch metadata for a single object — used for lightweight pre-flight checks. */
export async function getObjectMetadata(
  userId: string,
  bucket: string,
  key: string
): Promise<StorageMetadata> {
  const provider = getProviderForUser(userId, bucket);

  try {
    log.debug({ user_id: userId, bucket, key }, 'getting object metadata');
    return await provider.getMetadata(key);
  } catch (err) {
    if (err instanceof S3ServiceException) {
      mapS3ErrorToHttp(err, { bucket, key, operation: 'getMetadata' });
    }
    throw err;
  }
}

export type { S3ConnectionConfig };
