import {
  S3Client,
  S3ServiceException,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  type ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';
import type { StorageProvider, ObjectDownload } from './provider.js';
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
    log.debug({ bucket: this.bucket, prefix, page_size: pageSize }, 'listing objects');

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
    log.debug({ bucket: this.bucket, key }, 'getting object');
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
    log.debug({ bucket: this.bucket, key, start, end }, 'getting object range');
    const output = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=${start}-${end}` })
    );
    if (!output.Body) {
      throw new Error(`Object ${key} has no body`);
    }
    return output.Body.transformToWebStream();
  }

  async getMetadata(key: string): Promise<StorageMetadata> {
    log.debug({ bucket: this.bucket, key }, 'getting object metadata');
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
}
