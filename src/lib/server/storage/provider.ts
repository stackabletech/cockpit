import type {
  StoragePage,
  StorageMetadata,
  DeleteObjectsResult,
  SearchResultItem
} from '$lib/storage/types.js';
import type { LifecycleRule, BucketAcl, BucketVersioning } from '$lib/storage/details-types.js';

export type { DeleteObjectsResult };

/** Options accepted by {@link StorageProvider.search}. */
export interface SearchOptions {
  /** Limit the S3 listing to this key prefix. */
  prefix?: string;
  /** Maximum key depth relative to `prefix`. */
  maxDepth?: number;
  /** Abort the in-flight search; throws `AbortError` when signalled. */
  signal?: AbortSignal;
  /** Decide whether a scanned key matches the search. */
  matches?: (item: SearchResultItem) => boolean;
  /** Called immediately after each accepted result. */
  onMatch?: (item: SearchResultItem) => void;
}

/** Options for progressive key listing. */
export interface ProgressiveListOptions {
  /** Abort the currently pending provider page request. */
  signal?: AbortSignal;
}

/** Options accepted by {@link StorageProvider.copyObject}. */
export interface CopyObjectOptions {
  /** Bucket of the same connection to copy from. Defaults to the provider's bucket. */
  sourceBucket?: string;
  /** Size of the source when the caller already knows it; lets the provider skip reading it first. */
  size?: number;
  onProgress?: (loaded: number, total: number) => void;
  signal?: AbortSignal;
}

/** Result of a bucket-scoped search. */
export interface SearchResult {
  results: SearchResultItem[];
}

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
  /**
   * Replace an existing object in a single request, but only if its current
   * ETag still equals `etag` (S3 conditional write, `If-Match`). Throws an
   * HTTP 409 error when the object changed or vanished in the meantime.
   * Returns the ETag of the newly written object.
   */
  putObjectIfMatch(
    key: string,
    body: Buffer,
    contentType: string,
    etag: string
  ): Promise<string | undefined>;
  /**
   * Delete objects. With `expandDirectories`, a key ending in `/` also deletes
   * every object under it; without, only the named keys are deleted.
   */
  deleteObjects(keys: string[], expandDirectories: boolean): Promise<DeleteObjectsResult>;
  /**
   * Whether any object exists under `prefix`, including a folder marker equal
   * to `prefix` itself. Lists without a delimiter, so the marker is not hidden.
   */
  prefixExists(prefix: string, signal?: AbortSignal): Promise<boolean>;
  /**
   * List all objects under a prefix, recursively (no delimiter), handing them to
   * `onBatch` one listing page at a time; empty pages are skipped. Returning `false`
   * stops the listing.
   */
  listAllKeysProgressively(
    prefix: string,
    onBatch: (keys: Array<{ key: string; size: number; lastModified?: Date }>) => void | boolean,
    options?: ProgressiveListOptions
  ): Promise<void>;
  /**
   * Case-insensitive substring search across all keys in this bucket. Both
   * files (plain keys) and directories (keys ending in `/`) match.
   */
  search(query: string, options?: SearchOptions): Promise<SearchResult>;
  /*
   * Bucket info getters resolve to `null` when the setting could not be read
   * (access denied, unsupported by the backend, ...), as opposed to an empty
   * value when it is simply not configured.
   */
  getBucketVersioning(): Promise<BucketVersioning | null>;
  getBucketLifecycleRules(): Promise<LifecycleRule[] | null>;
  getBucketTags(): Promise<Record<string, string> | null>;
  getBucketAcl(): Promise<BucketAcl | null>;
  /**
   * Copy an object from `sourceKey` to `destKey` in this provider's bucket.
   * The source is read from `options.sourceBucket` (default: this bucket) of
   * the same connection. The copy runs entirely in the storage backend: S3
   * CopyObject for objects up to 5 GB, multipart UploadPartCopy above. Throws
   * if the source does not exist or access is denied. Existing destination
   * objects are silently overwritten.
   *
   * `options.onProgress` is called with `(loaded, total)` bytes after each part
   * of a multipart copy (> 5 GB); a single CopyObject reports nothing.
   * `options.signal` aborts the running requests; an aborted multipart copy is
   * still cleaned up.
   */
  copyObject(sourceKey: string, destKey: string, options?: CopyObjectOptions): Promise<void>;
}
