import {
  S3Client,
  S3ServiceException,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
  type ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { StorageProvider, ObjectDownload, DeleteObjectsResult } from './provider.js';
import type { S3Config } from './types.js';
import type { StoragePage, StorageObject, StorageMetadata } from '$lib/storage/types.js';
import { logger } from '$lib/server/logging';
import { createS3Client } from './s3-client.js';

const log = logger.child({ module: 's3-provider' });

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config, client?: S3Client) {
    this.bucket = config.bucket;
    this.client = client ?? createS3Client(config);
  }

  async listObjects(
    prefix: string,
    pageSize: number,
    continuationToken?: string | null
  ): Promise<StoragePage> {
    log.trace({ bucket: this.bucket, prefix, page_size: pageSize }, 'S3 ListObjectsV2');

    const output: ListObjectsV2CommandOutput = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix || undefined,
        Delimiter: '/',
        MaxKeys: pageSize,
        ContinuationToken: continuationToken ?? undefined
      })
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
    const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!output.Body) {
      throw new Error(`Object ${key} has no body`);
    }
    return {
      stream: output.Body.transformToWebStream(),
      contentType: output.ContentType,
      contentLength: output.ContentLength,
      etag: output.ETag
    };
  }

  async getObjectRange(key: string, start: number, end: number): Promise<ReadableStream> {
    log.trace({ bucket: this.bucket, key, start, end }, 'S3 GetObject (range)');
    const output = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` })
    );
    if (!output.Body) {
      throw new Error(`Object ${key} has no body`);
    }
    return output.Body.transformToWebStream();
  }

  async getMetadata(key: string): Promise<StorageMetadata> {
    log.trace({ bucket: this.bucket, key }, 'S3 HeadObject');
    const output = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    return {
      size: output.ContentLength ?? 0,
      lastModified: output.LastModified ?? new Date(0),
      contentType: output.ContentType,
      etag: output.ETag,
      customMetadata: output.Metadata
    };
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
    await upload.done();
  }

  async deleteObjects(keys: string[]): Promise<DeleteObjectsResult> {
    log.trace({ bucket: this.bucket, key_count: keys.length }, 'S3 DeleteObjects');

    // S3 DeleteObjects has a limit of 1000 keys per request.
    // MinIO/Ionos return MalformedXML when exceeding this limit.
    const MAX_KEYS = 1000;
    const allFailed: Array<{ key: string; code?: string; message?: string }> = [];

    for (let i = 0; i < keys.length; i += MAX_KEYS) {
      const chunk = keys.slice(i, i + MAX_KEYS);
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
