import type { StoragePage, StorageMetadata } from '$lib/storage/types.js';

/** Backend-agnostic interface for a bucket-scoped storage provider. */
export interface StorageProvider {
  listObjects(prefix: string, pageSize: number, page: number): Promise<StoragePage>;
  getObject(key: string): Promise<ReadableStream>;
  getMetadata(key: string): Promise<StorageMetadata>;
  exists(key: string): Promise<boolean>;
}
