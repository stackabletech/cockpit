import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  HeadObjectCommand,
  type ListObjectsV2CommandOutput
} from '@aws-sdk/client-s3';
import type { StorageProvider } from './provider.js';
import type { S3Config } from './types.js';
import type { StoragePage, StorageObject, StorageMetadata } from '$lib/types/storage.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 's3-provider' });

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
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
  }

  async listObjects(prefix: string, pageSize: number, page: number): Promise<StoragePage> {
    log.debug({ bucket: this.bucket, prefix, page_size: pageSize, page }, 'listing objects');

    // S3 uses cursor-based pagination via continuation tokens, not offset-based.
    // To reach page N we advance through N-1 pages sequentially.
    let continuationToken: string | undefined;
    let currentPage = 1;

    while (true) {
      const output: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix || undefined,
          Delimiter: '/',
          MaxKeys: pageSize,
          ContinuationToken: continuationToken
        })
      );

      if (currentPage === page) {
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
          currentPage,
          pageSize
        };
      }

      if (!output.IsTruncated || !output.NextContinuationToken) {
        return { objects: [], hasNextPage: false, currentPage: page, pageSize };
      }

      continuationToken = output.NextContinuationToken;
      currentPage++;
    }
  }

  async getObject(key: string): Promise<ReadableStream> {
    log.debug({ bucket: this.bucket, key }, 'getting object');
    const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
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
    } catch {
      return false;
    }
  }
}
