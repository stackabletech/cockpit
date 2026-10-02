import type { StoragePage, StorageMetadata, DeleteObjectsResult } from '$lib/storage/types.js';
import type { LifecycleRule, BucketAcl } from '$lib/storage/details-types.js';

export type { DeleteObjectsResult };

/** Metadata and body stream returned when fetching a storage object. */
export interface ObjectDownload {
  stream: ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
}

/** Backend-agnostic interface for a bucket-scoped storage provider. */
export interface StorageProvider {
  /** List all buckets accessible with the current connection credentials. */
  listContainers(): Promise<string[]>;
  /**
   * List objects using cursor-based pagination. `continuationToken` is the
   * provider-specific opaque token returned from a previous call. When
   * omitted, the first page is returned.
   */
  listObjects(
    prefix: string,
    pageSize: number,
    continuationToken?: string | null
  ): Promise<StoragePage>;
  getObject(key: string): Promise<ObjectDownload>;
  /**
   * Fetch a byte range of an object. Both `start` and `end` are inclusive,
   * following the HTTP `Range: bytes=start-end` convention.
   */
  getObjectRange(key: string, start: number, end: number): Promise<ReadableStream>;
  getMetadata(key: string): Promise<StorageMetadata>;
  exists(key: string): Promise<boolean>;
  /** Upload an object, using multipart upload for large files. */
  putObject(
    key: string,
    body: ReadableStream | Buffer,
    contentType: string,
    contentLength?: number
  ): Promise<void>;
  deleteObjects(keys: string[]): Promise<DeleteObjectsResult>;
  /**
   * List all object keys under a prefix, recursively (no delimiter).
   * Used to expand directory prefixes before deletion.
   */
  listAllKeys(prefix: string): Promise<string[]>;
  listAllKeysProgressively(
    prefix: string,
    onBatch: (keys: Array<{ key: string; size: number; lastModified?: Date }>) => void
  ): Promise<void>;
  getBucketVersioning(): Promise<string>;
  getBucketLifecycleRules(): Promise<LifecycleRule[]>;
  getBucketTags(): Promise<Record<string, string>>;
  getBucketAcl(): Promise<BucketAcl>;
  /**
   * Copy an object from `sourceKey` to `destKey` within the same bucket.
   * For objects <= 5 GB uses S3 CopyObject; for larger objects streams the
   * data through via multipart upload. Throws if the source does not exist
   * or access is denied. Existing destination objects are silently overwritten.
   *
   * When provided, `onProgress` is called with `(loaded, total)` bytes during
   * the multipart upload for large objects (> 5 GB). It is NOT called for
   * small objects that use the native S3 CopyObject (which is server-side and
   * has no streaming phase).
   */
  copyObject(
    sourceKey: string,
    destKey: string,
    onProgress?: (loaded: number, total: number) => void
  ): Promise<void>;
}
