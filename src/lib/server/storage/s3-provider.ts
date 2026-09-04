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
  GetBucketAclCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCopyCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type {
  StorageProvider,
  ObjectDownload,
  DeleteObjectsResult,
  SearchOptions,
  SearchResult,
  ProgressiveListOptions
} from './provider.js';
import type { S3Config } from './types.js';
import type {
  StoragePage,
  StorageObject,
  StorageMetadata,
  SearchResultItem
} from '$lib/storage/types.js';
import type { LifecycleRule, BucketAcl } from '$lib/storage/details-types.js';
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
    return mapS3ErrorToHttp(err, context);
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
    contentLength?: number,
    onProgress?: (loaded: number, total: number) => void
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
    if (onProgress && contentLength) {
      upload.on('httpUploadProgress', (progress) => {
        onProgress(progress.loaded ?? 0, contentLength);
      });
    }
    await withS3Errors(() => upload.done(), { bucket: this.bucket, key, operation: 'putObject' });
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    log.trace({ bucket: this.bucket, key_count: keys.length }, 'S3 DeleteObjects');

    if (keys.length === 0) {
      return { failed: [] };
    }

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
      const output = await withS3Errors(
        () =>
          this.client.send(
            new DeleteObjectsCommand({
              Bucket: this.bucket,
              Delete: {
                Objects: chunk.map((key) => ({ Key: key })),
                Quiet: true
              }
            })
          ),
        { bucket: this.bucket, operation: 'deleteObjects' }
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
  }

  async getBucketVersioning(): Promise<'Enabled' | 'Suspended' | 'Disabled'> {
    try {
      const output = await this.client.send(
        new GetBucketVersioningCommand({ Bucket: this.bucket })
      );
      if (output.Status === 'Enabled') return 'Enabled';
      if (output.Status === 'Suspended') return 'Suspended';
      return 'Disabled';
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

  async getBucketAcl(): Promise<BucketAcl> {
    try {
      const output = await this.client.send(new GetBucketAclCommand({ Bucket: this.bucket }));
      const owner = [output.Owner?.DisplayName, output.Owner?.ID].filter(Boolean).join(' / ');
      const grants = (output.Grants ?? []).map((g) => ({
        grantee:
          g.Grantee?.DisplayName ??
          g.Grantee?.EmailAddress ??
          g.Grantee?.ID ??
          g.Grantee?.URI ??
          g.Grantee?.Type ??
          'Unknown',
        permission: g.Permission ?? 'Unknown'
      }));
      return { owner: owner || 'Unknown', grants };
    } catch {
      return { owner: 'Unknown', grants: [] };
    }
  }

  async getBucketTags(): Promise<Record<string, string>> {
    try {
      const output = await this.client.send(new GetBucketTaggingCommand({ Bucket: this.bucket }));
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
    onBatch: (keys: Array<{ key: string; size: number; lastModified?: Date }>) => void | boolean,
    options?: ProgressiveListOptions
  ): Promise<void> {
    log.trace({ bucket: this.bucket, prefix }, 'S3 ListObjectsV2 (progressive, concurrent)');

    // Pipeline: while processing each page's results, the next page is already being
    // fetched.  Each page's continuation token is only known after its predecessor
    // completes, so we chain through `.then()` to keep one lookahead fetch in-flight.
    const inFlight: Array<Promise<ListObjectsV2CommandOutput>> = [];

    const fetchPage = (token?: string): Promise<ListObjectsV2CommandOutput> =>
      this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token
        }),
        { abortSignal: options?.signal }
      );

    // Seed the first fetch
    inFlight.push(fetchPage());

    while (inFlight.length > 0) {
      const output = await inFlight.shift()!;

      const batch: Array<{ key: string; size: number; lastModified?: Date }> = [];
      for (const obj of output.Contents ?? []) {
        if (obj.Key) {
          batch.push({ key: obj.Key, size: obj.Size ?? 0, lastModified: obj.LastModified });
        }
      }
      if (batch.length > 0) {
        const shouldStop = onBatch(batch) === false;
        if (shouldStop) break;
      }

      // If truncated, chain the next fetch so it starts while we process the
      // current page's results (or already completes by the time we loop back).
      if (output.IsTruncated && output.NextContinuationToken) {
        const token = output.NextContinuationToken;
        inFlight.push(fetchPage(token));
      }
    }

    log.trace({ bucket: this.bucket, prefix }, 'progressive listing complete');
  }

  async search(query: string, options?: SearchOptions): Promise<SearchResult> {
    const signal = options?.signal;
    const prefix = options?.prefix ?? '';
    const maxDepth = options?.maxDepth;
    const matches =
      options?.matches ??
      ((item: SearchResultItem) => item.key.toLowerCase().includes(query.toLowerCase()));
    const onMatch = options?.onMatch;

    log.trace(
      {
        bucket: this.bucket,
        query,
        prefix,
        max_depth: maxDepth
      },
      'S3 ListObjectsV2 (search)'
    );

    if (signal?.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }

    const results: SearchResultItem[] = [];

    await withS3Errors(
      () =>
        this.listAllKeysProgressively(
          prefix,
          (batch) => {
            for (const item of batch) {
              if (signal?.aborted) {
                throw new DOMException('The operation was aborted', 'AbortError');
              }
              const relativeKey = item.key.slice(prefix.length);
              if (
                maxDepth !== undefined &&
                relativeKey.split('/').filter(Boolean).length > maxDepth
              ) {
                continue;
              }
              const result = {
                key: item.key,
                size: item.size,
                lastModified: item.lastModified ?? new Date(0),
                isDirectory: item.key.endsWith('/')
              };
              if (matches(result)) {
                results.push(result);
                onMatch?.(result);
              }
            }
            return undefined;
          },
          { signal }
        ),
      { bucket: this.bucket, operation: 'search' }
    );

    log.info({ bucket: this.bucket, query, result_count: results.length }, 'search complete');
    return { results };
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

  async copyObject(
    sourceKey: string,
    destKey: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void> {
    log.trace({ bucket: this.bucket, source_key: sourceKey, dest_key: destKey }, 'S3 CopyObject');

    // S3 CopyObject has a 5 GB limit. For larger objects we use server-side
    // multipart copy (UploadPartCopy) so data never streams through the server.
    const HEAD_LIMIT = 5 * 1024 * 1024 * 1024;
    const metadata = await this.getMetadata(sourceKey);

    if (metadata.size <= HEAD_LIMIT) {
      await withS3Errors(
        () =>
          this.client.send(
            new CopyObjectCommand({
              Bucket: this.bucket,
              CopySource: `/${this.bucket}/${encodeURIComponent(sourceKey)}`,
              Key: destKey
            })
          ),
        { bucket: this.bucket, key: sourceKey, operation: 'copyObject' }
      );
      return;
    }

    log.info(
      { bucket: this.bucket, source_key: sourceKey, size: metadata.size },
      'object exceeds CopyObject limit, using server-side multipart copy'
    );

    await withS3Errors(
      async () => {
        const totalSize = metadata.size!;
        // 256 MiB parts — well within the 10 000-part limit even for multi-TB objects
        const PART_SIZE = 256 * 1024 * 1024;
        const numParts = Math.ceil(totalSize / PART_SIZE);

        const { UploadId } = await this.client.send(
          new CreateMultipartUploadCommand({
            Bucket: this.bucket,
            Key: destKey,
            ContentType: metadata.contentType ?? 'application/octet-stream'
          })
        );
        const uploadId = UploadId!;

        const parts: Array<{ PartNumber: number; ETag: string }> = [];
        try {
          for (let i = 0; i < numParts; i++) {
            const partNumber = i + 1;
            const startByte = i * PART_SIZE;
            const endByte = Math.min(startByte + PART_SIZE - 1, totalSize - 1);

            const { CopyPartResult } = await this.client.send(
              new UploadPartCopyCommand({
                Bucket: this.bucket,
                Key: destKey,
                UploadId: uploadId,
                PartNumber: partNumber,
                CopySource: `/${this.bucket}/${encodeURIComponent(sourceKey)}`,
                CopySourceRange: `bytes=${startByte}-${endByte}`
              })
            );

            parts.push({
              PartNumber: partNumber,
              ETag: CopyPartResult?.ETag ?? ''
            });

            if (onProgress) {
              onProgress(Math.min((i + 1) * PART_SIZE, totalSize), totalSize);
            }
          }

          await this.client.send(
            new CompleteMultipartUploadCommand({
              Bucket: this.bucket,
              Key: destKey,
              UploadId: uploadId,
              MultipartUpload: { Parts: parts }
            })
          );
        } catch (err) {
          try {
            await this.client.send(
              new AbortMultipartUploadCommand({
                Bucket: this.bucket,
                Key: destKey,
                UploadId: uploadId
              })
            );
          } catch {
            // best-effort cleanup
          }
          throw err;
        }
      },
      { bucket: this.bucket, key: sourceKey, operation: 'copyObject' }
    );
  }
}
