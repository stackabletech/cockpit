import {
  S3Client,
  S3ServiceException,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  GetBucketVersioningCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketTaggingCommand,
  type ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageProvider, ObjectDownload, DeleteObjectsResult } from './provider.js';
import type { S3Config } from './types.js';
import type { StoragePage, StorageObject, StorageMetadata } from '$lib/storage/types.js';
import type { LifecycleRule } from '$lib/storage/details-types.js';
import { logger } from '$lib/server/logging';
import { createS3Client } from './s3-client.js';
import { mapS3ErrorToHttp } from './s3-errors.js';

const log = logger.child({ module: 's3-provider' });

/** Runs `fn` and maps any S3ServiceException to an HTTP error via `mapS3ErrorToHttp`. */
async function withS3Errors<T>(
  fn: () => Promise<T>,
  context: Parameters<typeof mapS3ErrorToHttp>[1]
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapS3ErrorToHttp(err, context);
  }
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config, client?: S3Client) {
    this.bucket = config.bucket;
    this.client = client ?? createS3Client(config);
  }

  async listContainers(): Promise<string[]> {
    log.trace({ bucket: this.bucket }, 'S3 ListBuckets');
    return withS3Errors(
      async () => {
        const output = await this.client.send(new ListBucketsCommand({}));
        const buckets = (output.Buckets ?? []).map((b) => b.Name ?? '').filter(Boolean);
        log.debug({ bucket_count: buckets.length }, 'listed buckets');
        return buckets;
      },
      { operation: 'listBuckets' }
    );
  }

  async listObjects(
    prefix: string,
    pageSize: number,
    continuationToken?: string | null
  ): Promise<StoragePage> {
    log.trace({ bucket: this.bucket, prefix, page_size: pageSize }, 'S3 ListObjectsV2');
    const output = await withS3Errors(
      () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix || undefined,
            Delimiter: '/',
            MaxKeys: pageSize,
            ContinuationToken: continuationToken ?? undefined
          })
        ),
      { bucket: this.bucket, operation: 'listObjects' }
    );

    const objects: StorageObject[] = [
      ...(output.CommonPrefixes ?? []).map((cp) => ({
        key: cp.Prefix ?? '',
        size: 0,
        lastModified: new Date(0),
        isDirectory: true,
        contentType: undefined
      })),
      ...(output.Contents ?? [])
        // Filter out the prefix itself (S3 sometimes echoes it back)
        .filter((obj) => obj.Key !== prefix)
        .map((obj) => ({
          key: obj.Key ?? '',
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(0),
          isDirectory: false,
          contentType: undefined
        }))
    ];

    return {
      objects,
      hasNextPage: output.IsTruncated ?? false,
      currentPage: 1,
      pageSize,
      continuationToken: continuationToken ?? null,
      nextContinuationToken: output.NextContinuationToken ?? null
    };
  }

  async getObject(key: string): Promise<ObjectDownload> {
    log.trace({ bucket: this.bucket, key }, 'S3 GetObject');
    return withS3Errors(
      async () => {
        const output = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key })
        );
        if (!output.Body) {
          throw new Error(`Object ${key} has no body`);
        }
        return {
          stream: output.Body.transformToWebStream(),
          contentType: output.ContentType,
          contentLength: output.ContentLength,
          etag: output.ETag
        };
      },
      { bucket: this.bucket, key, operation: 'getObject' }
    );
  }

  async getObjectRange(key: string, start: number, end: number): Promise<ReadableStream> {
    log.trace({ bucket: this.bucket, key, start, end }, 'S3 GetObject (range)');
    return withS3Errors(
      async () => {
        const output = await this.client.send(
          new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` })
        );
        if (!output.Body) {
          throw new Error(`Object ${key} has no body`);
        }
        return output.Body.transformToWebStream();
      },
      { bucket: this.bucket, key, operation: 'getObjectRange' }
    );
  }

  async getMetadata(key: string): Promise<StorageMetadata> {
    log.trace({ bucket: this.bucket, key }, 'S3 HeadObject');
    return withS3Errors(
      async () => {
        const output = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key })
        );
        return {
          size: output.ContentLength ?? 0,
          lastModified: output.LastModified ?? new Date(0),
          contentType: output.ContentType,
          etag: output.ETag,
          customMetadata: output.Metadata,
          versionId: output.VersionId,
          storageClass: output.StorageClass,
          isDeleteMarker: output.DeleteMarker ?? false
        };
      },
      { bucket: this.bucket, key, operation: 'getMetadata' }
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      if (err instanceof S3ServiceException) {
        const code = err.name;
        if (code === 'NoSuchKey' || code === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
          return false;
        }
      }
      throw err;
    }
  }

  async putObject(
    key: string,
    body: ReadableStream | Buffer,
    contentType: string,
    contentLength?: number
  ): Promise<void> {
    log.trace(
      { bucket: this.bucket, key, content_type: contentType, content_length: contentLength },
      'S3 Upload'
    );

    // Empty files cannot use multipart upload (S3 rejects empty parts).
    // Use a simple PutObject request instead.
    if (contentLength === 0) {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: Buffer.alloc(0),
          ContentType: contentType,
          ContentLength: 0
        })
      );
      return;
    }

    const upload = new Upload({
      client: this.client,
      queueSize: 4,
      partSize: 5 * 1024 * 1024,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ...(contentLength !== undefined ? { ContentLength: contentLength } : {})
      }
    });
    await withS3Errors(() => upload.done(), { bucket: this.bucket, key, operation: 'putObject' });
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    log.trace({ bucket: this.bucket, key_count: keys.length }, 'S3 DeleteObjects');

    if (keys.length === 0) {
      return { failed: [] };
    }

    return withS3Errors(
      async () => {
        // Expand directory prefixes to their contained keys
        const resolvedKeys: string[] = [];
        for (const key of keys) {
          if (key.endsWith('/')) {
            const children = await this.listAllKeys(key);
            if (children.length > 0) {
              resolvedKeys.push(...children);
            } else {
              resolvedKeys.push(key);
            }
          } else {
            resolvedKeys.push(key);
          }
        }

        // S3 DeleteObjects has a limit of 1000 keys per request.
        // MinIO/Ionos return MalformedXML when exceeding this limit.
        const MAX_KEYS = 1000;
        const allFailed: Array<{ key: string; code?: string; message?: string }> = [];

        for (let i = 0; i < resolvedKeys.length; i += MAX_KEYS) {
          const chunk = resolvedKeys.slice(i, i + MAX_KEYS);
          log.trace(
            { bucket: this.bucket, chunk_offset: i, chunk_size: chunk.length },
            'S3 DeleteObjects chunk'
          );
          const output = await this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: chunk.map((key) => ({ Key: key })),
                Quiet: true
              }
            })
          );
          const failed = (output.Errors ?? []).map((e) => ({
            key: e.Key ?? '',
            code: e.Code,
            message: e.Message
          }));
          allFailed.push(...failed);
        }

        if (allFailed.length > 0) {
          log.warn(
            { bucket: this.bucket, failed_count: allFailed.length },
            'some objects failed to delete'
          );
        }
        return { failed: allFailed };
      },
      { bucket: this.bucket, operation: 'deleteObjects' }
    );
  }

  async getBucketVersioning(): Promise<string> {
    try {
      const output = await this.client.send(
        new GetBucketVersioningCommand({ Bucket: this.bucket })
      );
      return output.Status ?? 'Disabled';
    } catch {
      return 'Disabled';
    }
  }

  async getBucketLifecycleRules(): Promise<LifecycleRule[]> {
    try {
      const output = await this.client.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket })
      );
      return (output.Rules ?? []).map((rule) => {
        const expiration = rule.Expiration;
        const noncurrentExpiration = rule.NoncurrentVersionExpiration;
        const abortMpu = rule.AbortIncompleteMultipartUpload;

        return {
          id: rule.ID ?? '',
          status: rule.Status === 'Enabled' ? 'Enabled' : 'Disabled',
          filter: (rule.Filter as Record<string, unknown>) ?? {},
          transitions: (rule.Transitions ?? []).map((t) => ({
            days: t.Days ?? 0,
            storageClass: t.StorageClass ?? ''
          })),
          expirations: expiration
            ? [
                {
                  days: expiration.Days,
                  date: expiration.Date?.toISOString(),
                  expiredObjectDeleteMarker: expiration.ExpiredObjectDeleteMarker
                }
              ]
            : [],
          noncurrentVersionTransitions: (rule.NoncurrentVersionTransitions ?? []).map((t) => ({
            noncurrentDays: t.NoncurrentDays ?? 0,
            storageClass: t.StorageClass ?? ''
          })),
          noncurrentVersionExpirations: noncurrentExpiration
            ? [{ noncurrentDays: noncurrentExpiration.NoncurrentDays ?? 0 }]
            : [],
          abortIncompleteMultipartUploads: abortMpu
            ? [{ daysAfterInitiation: abortMpu.DaysAfterInitiation ?? 0 }]
            : []
        };
      });
    } catch {
      return [];
    }
  }

  async getBucketTags(): Promise<Record<string, string>> {
    try {
      const output = await this.client.send(
        new GetBucketTaggingCommand({ Bucket: this.bucket })
      );
      const tags: Record<string, string> = {};
      for (const tag of output.TagSet ?? []) {
        if (tag.Key) tags[tag.Key] = tag.Value ?? '';
      }
      return tags;
    } catch {
      return {};
    }
  }

  async listAllKeysProgressively(
    prefix: string,
    onBatch: (keys: Array<{ key: string; size: number }>) => void
  ): Promise<void> {
    log.trace({ bucket: this.bucket, prefix }, 'S3 ListObjectsV2 (progressive)');
    let continuationToken: string | undefined;

    do {
      const output: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      );
      const batch: Array<{ key: string; size: number }> = [];
      for (const obj of output.Contents ?? []) {
        if (obj.Key) {
          batch.push({ key: obj.Key, size: obj.Size ?? 0 });
        }
      }
      if (batch.length > 0) {
        onBatch(batch);
      }
      continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
    } while (continuationToken);

    log.trace(
      { bucket: this.bucket, prefix },
      'progressive listing complete'
    );
  }

  async listAllKeys(prefix: string): Promise<string[]> {
    log.trace({ bucket: this.bucket, prefix }, 'S3 ListObjectsV2 (recursive)');
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const output: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        })
      );
      for (const obj of output.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
    } while (continuationToken);

    log.trace(
      { bucket: this.bucket, prefix, key_count: keys.length },
      'recursive listing complete'
    );
    return keys;
  }
}
