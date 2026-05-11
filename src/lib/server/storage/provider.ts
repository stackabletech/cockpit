import type { StoragePage, StorageMetadata } from '$lib/storage/types.js';

/** Metadata and body stream returned when fetching a storage object. */
export interface ObjectDownload {
  stream: ReadableStream;
  contentType?: string;
  contentLength?: number;
  etag?: string;
}

/** Backend-agnostic interface for a bucket-scoped storage provider. */
export interface StorageProvider {
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
  getMetadata(key: string): Promise<StorageMetadata>;
  exists(key: string): Promise<boolean>;
}
