import { S3ServiceException, ListBucketsCommand } from '@aws-sdk/client-s3';
import { createS3Client } from './s3-client.js';
import { mapS3ErrorToHttp } from './s3-errors.js';
import { getProvider } from './utils.js';
import type { StoragePage, StorageMetadata } from '$lib/storage/types.js';
import type { ObjectDownload, DeleteObjectsResult } from './provider.js';
import type { S3ConnectionConfig } from './types.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-service' });

/** List all buckets accessible with the given connection config. */
export async function listBuckets(config: S3ConnectionConfig): Promise<string[]> {
  const client = createS3Client(config);

  const output = await client.send(new ListBucketsCommand({}));
  const buckets = (output.Buckets ?? []).map((b) => b.Name ?? '').filter(Boolean);
  log.debug({ storage_type: config.type, bucket_count: buckets.length }, 'listed buckets');
  return buckets;
}

/** List objects at the given bucket/prefix. Throws on S3 errors. */
export async function listObjects(
  config: S3ConnectionConfig,
  bucket: string,
  prefix: string,
  pageSize: number,
  continuationToken?: string | null
): Promise<StoragePage> {
  const provider = getProvider(config, bucket);

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
  config: S3ConnectionConfig,
  bucket: string,
  key: string
): Promise<ObjectDownload> {
  const provider = getProvider(config, bucket);

  try {
    log.debug({ bucket, key }, 'downloading object');
    const download = await provider.getObject(key);
    log.info({ bucket, key }, 'object download started');
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
  config: S3ConnectionConfig,
  bucket: string,
  key: string
): Promise<StorageMetadata> {
  const provider = getProvider(config, bucket);

  try {
    log.debug({ bucket, key }, 'getting object metadata');
    return await provider.getMetadata(key);
  } catch (err) {
    if (err instanceof S3ServiceException) {
      mapS3ErrorToHttp(err, { bucket, key, operation: 'getMetadata' });
    }
    throw err;
  }
}

/** Upload an object to the bucket, using multipart upload for large files. */
export async function uploadObject(
  config: S3ConnectionConfig,
  bucket: string,
  key: string,
  body: ReadableStream | Buffer,
  contentType: string,
  contentLength?: number
): Promise<void> {
  const provider = getProvider(config, bucket);

  try {
    log.debug({ bucket, key, content_type: contentType }, 'uploading object');
    await provider.putObject(key, body, contentType, contentLength);
    log.info(
      { bucket, key, content_type: contentType, content_length: contentLength },
      'object uploaded'
    );
  } catch (err) {
    if (err instanceof S3ServiceException) {
      mapS3ErrorToHttp(err, { bucket, key, operation: 'putObject' });
    }
    throw err;
  }
}

/** Delete one or more objects from the bucket. Returns a result listing any keys that failed.
 *  Directory keys (ending with '/') are expanded to all contained objects before deletion. */
export async function deleteObjects(
  config: S3ConnectionConfig,
  bucket: string,
  keys: string[]
): Promise<DeleteObjectsResult> {
  const provider = getProvider(config, bucket);

  try {
    // Expand any directory prefixes (keys ending with '/') to their contents.
    const dirPrefixes = keys.filter((k) => k.endsWith('/'));
    const fileKeys = keys.filter((k) => !k.endsWith('/'));

    let allKeys = [...fileKeys];
    for (const prefix of dirPrefixes) {
      log.debug({ bucket, prefix }, 'expanding directory prefix for deletion');
      const children = await provider.listAllKeys(prefix);
      allKeys = allKeys.concat(children.length > 0 ? children : [prefix]);
    }

    if (allKeys.length === 0) {
      return { failed: [] };
    }

    log.debug({ bucket, key_count: allKeys.length }, 'deleting objects');
    const result = await provider.deleteObjects(allKeys);
    log.info(
      { bucket, key_count: allKeys.length, failed_count: result.failed.length },
      'objects delete completed'
    );
    return result;
  } catch (err) {
    if (err instanceof S3ServiceException) {
      mapS3ErrorToHttp(err, { bucket, operation: 'deleteObjects' });
    }
    throw err;
  }
}
