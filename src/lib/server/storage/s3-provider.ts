import {
  S3Client,
  S3ServiceException,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
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
import { error } from '@sveltejs/kit';
import type {
  StorageProvider,
  ObjectDownload,
  DeleteObjectsResult,
  SearchOptions,
  SearchResult,
  ProgressiveListOptions,
  CopyObjectOptions
} from './provider.js';
import type { S3Config } from './types.js';
import type {
  StoragePage,
  StorageObject,
  StorageMetadata,
  SearchResultItem
} from '$lib/storage/types.js';
import type { LifecycleRule, BucketAcl, BucketVersioning } from '$lib/storage/details-types.js';
import { logger } from '$lib/server/logging';
import { createS3Client } from './s3-client.js';
import { mapS3ErrorToHttp } from './s3-errors.js';

const log = logger.child({ module: 's3-provider' });

/**
 * Listings request `EncodingType: 'url'` so that keys with characters XML cannot carry (most
 * control characters) or that XML parsing normalises (`\r`) arrive intact. S3 then encodes
 * `Key`, `Prefix`, `CommonPrefixes[].Prefix`, `StartAfter` and `Delimiter` in the response, using
 * form encoding: AWS sends a space as `+` and a literal `+` as `%2B`, so `+` is decoded as a space
 * before percent-decoding, as botocore (the AWS SDK for Python) does. Continuation tokens are not
 * encoded.
 */
const LIST_ENCODING_TYPE = 'url';

/** Deletes of keys DeleteObjects cannot name run with this many requests in flight. */
const SINGLE_DELETE_CONCURRENCY = 4;

/**
 * The decoder for a listing response's key fields. Only a response that echoes
 * `EncodingType: 'url'` is decoded (as botocore does): a store that ignores the parameter returns
 * raw keys, where `+` and `%` are literal.
 */
function listingDecoder(output: { EncodingType?: string }): (value: string) => string {
  return output.EncodingType === LIST_ENCODING_TYPE ? decodeListingValue : (value) => value;
}

/** Decodes a url-encoded listing field. A malformed value is returned unchanged. */
function decodeListingValue(value: string): string {
  try {
    return decodeURIComponent(value.replaceAll('+', ' '));
  } catch {
    log.warn({ encoded_value: value }, 'S3 listing returned a malformed url-encoded value');
    return value;
  }
}

/**
 * Whether XML 1.0 can carry `key`. DeleteObjects names keys in an XML body, and S3 rejects the
 * whole request as MalformedXML when a key holds a C0 control character other than tab, newline
 * or carriage return (the SDK escapes those), a non-character or an unpaired surrogate.
 */
function isXmlSafeKey(key: string): boolean {
  if (!key.isWellFormed()) return false;
  return [...key].every((char) => {
    const codePoint = char.codePointAt(0)!;
    if (codePoint < 0x20) return codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    return codePoint !== 0xfffe && codePoint !== 0xffff;
  });
}

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
            ContinuationToken: continuationToken ?? undefined,
            EncodingType: LIST_ENCODING_TYPE
          })
        ),
      { bucket: this.bucket, operation: 'listObjects' }
    );

    const decode = listingDecoder(output);
    const objects: StorageObject[] = [
      ...(output.CommonPrefixes ?? []).map((cp) => ({
        key: decode(cp.Prefix ?? ''),
        size: 0,
        lastModified: new Date(0),
        isDirectory: true,
        contentType: undefined
      })),
      ...(output.Contents ?? [])
        .map((obj) => ({ ...obj, Key: decode(obj.Key ?? '') }))
        // Filter out the prefix itself (S3 sometimes echoes it back)
        .filter((obj) => obj.Key !== prefix)
        .map((obj) => ({
          key: obj.Key,
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
      await withS3Errors(
        () =>
          this.client.send(
            new PutObjectCommand({
              Bucket: this.bucket,
              Key: key,
              Body: Buffer.alloc(0),
              ContentType: contentType,
              ContentLength: 0
            })
          ),
        { bucket: this.bucket, key, operation: 'putObject' }
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

  async putObjectIfMatch(
    key: string,
    body: Buffer,
    contentType: string,
    etag: string
  ): Promise<string | undefined> {
    log.trace(
      { bucket: this.bucket, key, content_type: contentType, content_length: body.length },
      'S3 PutObject (If-Match)'
    );
    const put = (ifMatch?: string) =>
      this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          ...(ifMatch !== undefined ? { IfMatch: ifMatch } : {})
        })
      );

    try {
      return (await put(etag)).ETag;
    } catch (err) {
      if (!(err instanceof S3ServiceException)) throw err;
      const status = err.$metadata?.httpStatusCode;
      // 412: ETag no longer matches. 409: concurrent conditional write.
      // 404: the object was deleted since it was loaded.
      if (status === 412 || status === 409 || status === 404) {
        log.info(
          { bucket: this.bucket, key, error_code: err.name, status_code: status },
          'conditional PutObject rejected: object changed since it was loaded'
        );
        throw error(409, 'The object was modified since it was loaded');
      }
      // Providers without conditional-write support reject the header. The
      // caller's HEAD comparison is then the only (racy) guard.
      if (status === 501) {
        log.warn(
          { bucket: this.bucket, key, error_code: err.name },
          'S3 provider does not support If-Match on PutObject; retrying unconditionally'
        );
        return withS3Errors(async () => (await put()).ETag, {
          bucket: this.bucket,
          key,
          operation: 'putObject'
        });
      }
      return mapS3ErrorToHttp(err, { bucket: this.bucket, key, operation: 'putObject' });
    }
  }

  async deleteObjects(keys: string[], expandDirectories: boolean): Promise<DeleteObjectsResult> {
    log.trace({ bucket: this.bucket, key_count: keys.length }, 'S3 DeleteObjects');

    if (keys.length === 0) {
      return { failed: [] };
    }

    // Expand directory prefixes to their contained keys
    const resolvedKeys: string[] = [];
    for (const key of keys) {
      if (expandDirectories && key.endsWith('/')) {
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

    // Keys XML cannot carry are deleted one by one, so they neither fail nor block a batch.
    const batchKeys = resolvedKeys.filter(isXmlSafeKey);
    allFailed.push(...(await this.deleteSingly(resolvedKeys.filter((key) => !isXmlSafeKey(key)))));

    for (let i = 0; i < batchKeys.length; i += MAX_KEYS) {
      const chunk = batchKeys.slice(i, i + MAX_KEYS);
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

  /** Deletes keys with individual DeleteObject requests, a few at a time. */
  private async deleteSingly(
    keys: string[]
  ): Promise<Array<{ key: string; code?: string; message?: string }>> {
    const failed: Array<{ key: string; code?: string; message?: string }> = [];
    const pending = [...keys];
    const worker = async () => {
      for (let key = pending.shift(); key !== undefined; key = pending.shift()) {
        log.debug({ bucket: this.bucket, key }, 'S3 DeleteObject (key not representable in XML)');
        try {
          await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
        } catch (err) {
          if (!(err instanceof S3ServiceException)) throw err;
          failed.push({ key, code: err.name, message: err.message });
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SINGLE_DELETE_CONCURRENCY, keys.length) }, worker)
    );
    return failed;
  }

  /**
   * Runs a bucket-info request. Errors whose code is in `emptyCodes` mean the
   * setting is not configured and yield `empty`; any other failure is logged
   * and yields `null`, so callers can show the section as unavailable rather
   * than as a misleading default.
   */
  private async bucketInfo<T>(
    operation: string,
    fn: () => Promise<T>,
    empty?: { codes: string[]; value: T }
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (err) {
      const isS3 = err instanceof S3ServiceException;
      if (isS3 && empty?.codes.includes(err.name)) return empty.value;
      log.warn(
        {
          bucket: this.bucket,
          operation,
          error_code: isS3 ? err.name : undefined,
          status_code: isS3 ? err.$metadata?.httpStatusCode : undefined,
          err: isS3 ? undefined : err
        },
        'bucket info request failed'
      );
      return null;
    }
  }

  async getBucketVersioning(): Promise<BucketVersioning | null> {
    return this.bucketInfo('getBucketVersioning', async () => {
      const output = await this.client.send(
        new GetBucketVersioningCommand({ Bucket: this.bucket })
      );
      if (output.Status === 'Enabled') return 'Enabled';
      if (output.Status === 'Suspended') return 'Suspended';
      return 'Disabled';
    });
  }

  async getBucketLifecycleRules(): Promise<LifecycleRule[] | null> {
    return this.bucketInfo(
      'getBucketLifecycleRules',
      async () => {
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
      },
      { codes: ['NoSuchLifecycleConfiguration'], value: [] }
    );
  }

  async getBucketAcl(): Promise<BucketAcl | null> {
    return this.bucketInfo('getBucketAcl', async () => {
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
    });
  }

  async getBucketTags(): Promise<Record<string, string> | null> {
    return this.bucketInfo(
      'getBucketTags',
      async () => {
        const output = await this.client.send(new GetBucketTaggingCommand({ Bucket: this.bucket }));
        const tags: Record<string, string> = {};
        for (const tag of output.TagSet ?? []) {
          if (tag.Key) tags[tag.Key] = tag.Value ?? '';
        }
        return tags;
      },
      { codes: ['NoSuchTagSet'], value: {} }
    );
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
          ContinuationToken: token,
          EncodingType: LIST_ENCODING_TYPE
        }),
        { abortSignal: options?.signal }
      );

    // Seed the first fetch
    inFlight.push(fetchPage());

    while (inFlight.length > 0) {
      const output = await inFlight.shift()!;

      const decode = listingDecoder(output);
      const batch: Array<{ key: string; size: number; lastModified?: Date }> = [];
      for (const obj of output.Contents ?? []) {
        if (obj.Key) {
          batch.push({
            key: decode(obj.Key),
            size: obj.Size ?? 0,
            lastModified: obj.LastModified
          });
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
          ContinuationToken: continuationToken,
          EncodingType: LIST_ENCODING_TYPE
        })
      );
      const decode = listingDecoder(output);
      for (const obj of output.Contents ?? []) {
        if (obj.Key) keys.push(decode(obj.Key));
      }
      continuationToken = output.IsTruncated ? output.NextContinuationToken : undefined;
    } while (continuationToken);

    log.trace(
      { bucket: this.bucket, prefix, key_count: keys.length },
      'recursive listing complete'
    );
    return keys;
  }

  async prefixExists(prefix: string, signal?: AbortSignal): Promise<boolean> {
    log.trace({ bucket: this.bucket, prefix }, 'S3 ListObjectsV2 (prefix exists)');
    const output = await withS3Errors(
      () =>
        this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: prefix,
            MaxKeys: 1,
            EncodingType: LIST_ENCODING_TYPE
          }),
          { abortSignal: signal }
        ),
      { bucket: this.bucket, operation: 'prefixExists' }
    );
    return (output.Contents ?? []).length > 0;
  }

  async copyObject(
    sourceKey: string,
    destKey: string,
    options: CopyObjectOptions = {}
  ): Promise<void> {
    const { onProgress, signal } = options;
    const sourceBucket = options.sourceBucket ?? this.bucket;
    const copySource = `/${sourceBucket}/${encodeURIComponent(sourceKey)}`;
    // The HEAD reads the source; every later request writes the destination.
    const sourceContext = { bucket: sourceBucket, key: sourceKey, operation: 'copyObject' };
    const context = { bucket: this.bucket, key: destKey, operation: 'copyObject' };
    log.trace(
      {
        bucket: this.bucket,
        source_bucket: sourceBucket,
        source_key: sourceKey,
        dest_key: destKey
      },
      'S3 CopyObject'
    );

    // S3 CopyObject has a 5 GB limit. For larger objects we use server-side
    // multipart copy (UploadPartCopy) so data never streams through the server.
    const HEAD_LIMIT = 5 * 1024 * 1024 * 1024;
    const head = await withS3Errors(
      () =>
        this.client.send(new HeadObjectCommand({ Bucket: sourceBucket, Key: sourceKey }), {
          abortSignal: signal
        }),
      sourceContext
    );
    const size = head.ContentLength ?? 0;

    if (size <= HEAD_LIMIT) {
      await withS3Errors(
        () =>
          this.client.send(
            new CopyObjectCommand({ Bucket: this.bucket, CopySource: copySource, Key: destKey }),
            { abortSignal: signal }
          ),
        context
      );
      return;
    }

    log.info(
      { bucket: this.bucket, source_bucket: sourceBucket, source_key: sourceKey, size },
      'object exceeds CopyObject limit, using server-side multipart copy'
    );

    await withS3Errors(async () => {
      // 256 MiB parts — well within the 10 000-part limit even for multi-TB objects
      const PART_SIZE = 256 * 1024 * 1024;
      const numParts = Math.ceil(size / PART_SIZE);

      // Not tied to `signal`: an upload created while the request is aborted would
      // have no ID to clean up with. A cancel is checked right after instead.
      const { UploadId } = await this.client.send(
        new CreateMultipartUploadCommand({
          Bucket: this.bucket,
          Key: destKey,
          ContentType: head.ContentType ?? 'application/octet-stream'
        })
      );
      const uploadId = UploadId!;

      const parts: Array<{ PartNumber: number; ETag: string }> = [];
      try {
        signal?.throwIfAborted();
        for (let i = 0; i < numParts; i++) {
          const partNumber = i + 1;
          const startByte = i * PART_SIZE;
          const endByte = Math.min(startByte + PART_SIZE - 1, size - 1);

          const { CopyPartResult } = await this.client.send(
            new UploadPartCopyCommand({
              Bucket: this.bucket,
              Key: destKey,
              UploadId: uploadId,
              PartNumber: partNumber,
              CopySource: copySource,
              CopySourceRange: `bytes=${startByte}-${endByte}`,
              // Pin every part to the version the HEAD saw: if the source is
              // overwritten mid-copy, S3 answers 412 instead of mixing versions.
              CopySourceIfMatch: head.ETag
            }),
            { abortSignal: signal }
          );

          parts.push({
            PartNumber: partNumber,
            ETag: CopyPartResult?.ETag ?? ''
          });

          if (onProgress) {
            onProgress(Math.min((i + 1) * PART_SIZE, size), size);
          }
        }

        // Not tied to `signal` either: once every part is copied, aborting the
        // completion could leave it unknown whether the object was written.
        signal?.throwIfAborted();
        await this.client.send(
          new CompleteMultipartUploadCommand({
            Bucket: this.bucket,
            Key: destKey,
            UploadId: uploadId,
            MultipartUpload: { Parts: parts }
          })
        );
      } catch (err) {
        // Not tied to `signal`: an aborted copy must still release its parts.
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
    }, context);
  }
}
