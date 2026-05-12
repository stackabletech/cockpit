import type { StoragePage, StorageMetadata } from '$lib/storage/types.js';

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
  getObject(key: string): Promise<ReadableStream>;
  /**
   * Fetch a byte range of an object. Both `start` and `end` are inclusive,
   * following the HTTP `Range: bytes=start-end` convention.
   */
  getObjectRange(key: string, start: number, end: number): Promise<ReadableStream>;
  getMetadata(key: string): Promise<StorageMetadata>;
  exists(key: string): Promise<boolean>;
}
