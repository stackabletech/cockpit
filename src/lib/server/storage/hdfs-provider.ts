import type { StorageProvider } from './provider.js';
import type { HDFSConfig } from './types.js';
import type { StoragePage, StorageMetadata } from '$lib/types/storage.js';

/** Stub implementation — HDFS support is not yet implemented. */
export class HDFSStorageProvider implements StorageProvider {
  constructor(_config: HDFSConfig) {}

  listObjects(_prefix: string, _pageSize: number, _page: number): Promise<StoragePage> {
    throw new Error('HDFS not implemented');
  }

  getObject(_key: string): Promise<ReadableStream> {
    throw new Error('HDFS not implemented');
  }

  getMetadata(_key: string): Promise<StorageMetadata> {
    throw new Error('HDFS not implemented');
  }

  exists(_key: string): Promise<boolean> {
    throw new Error('HDFS not implemented');
  }
}
