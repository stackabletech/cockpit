import type { StorageProvider } from './provider.js';
import type { HDFSConfig } from './types.js';
import type { StoragePage, StorageMetadata } from '$lib/storage/types.js';

/* TODO: Remove this file and related HDFS provider code until we have a concrete plan for HDFS support.
 For now, this serves as a placeholder to prevent compile errors. */
/* eslint-disable  @typescript-eslint/no-unused-vars */

/** Stub implementation — HDFS support is not yet implemented. */
export class HDFSStorageProvider implements StorageProvider {
  constructor(_config: HDFSConfig) {}

  listObjects(
    _prefix: string,
    _pageSize: number,
    _continuationToken?: string | null
  ): Promise<StoragePage> {
    throw new Error('HDFS not implemented');
  }

  getObject(_key: string): Promise<ReadableStream> {
    throw new Error('HDFS not implemented');
  }

  getObjectRange(_key: string, _start: number, _end: number): Promise<ReadableStream> {
    throw new Error('HDFS not implemented');
  }

  getMetadata(_key: string): Promise<StorageMetadata> {
    throw new Error('HDFS not implemented');
  }

  exists(_key: string): Promise<boolean> {
    throw new Error('HDFS not implemented');
  }
}
