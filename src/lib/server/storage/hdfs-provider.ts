import type { StorageProvider, ObjectDownload, DeleteObjectsResult } from './provider.js';
import type { HDFSConfig } from './types.js';
import type { StoragePage, StorageMetadata } from '$lib/storage/types.js';
import type { LifecycleRule, BucketAcl } from '$lib/storage/details-types.js';

/* TODO: Remove this file and related HDFS provider code until we have a concrete plan for HDFS support.
 For now, this serves as a placeholder to prevent compile errors. */
/* eslint-disable  @typescript-eslint/no-unused-vars */

/** Stub implementation — HDFS support is not yet implemented. */
export class HDFSStorageProvider implements StorageProvider {
  constructor(_config: HDFSConfig) {}

  listContainers(): Promise<string[]> {
    throw new Error('HDFS not implemented');
  }

  listObjects(
    _prefix: string,
    _pageSize: number,
    _continuationToken?: string | null
  ): Promise<StoragePage> {
    throw new Error('HDFS not implemented');
  }

  getObject(_key: string): Promise<ObjectDownload> {
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

  putObject(
    _key: string,
    _body: ReadableStream | Buffer,
    _contentType: string,
    _contentLength?: number
  ): Promise<void> {
    throw new Error('HDFS not implemented');
  }

  deleteObjects(_keys: string[]): Promise<DeleteObjectsResult> {
    throw new Error('HDFS not implemented');
  }

  listAllKeys(_prefix: string): Promise<string[]> {
    throw new Error('HDFS not implemented');
  }

  listAllKeysProgressively(
    _prefix: string,
    _onBatch: (keys: Array<{ key: string; size: number }>) => void
  ): Promise<void> {
    throw new Error('HDFS not implemented');
  }

  getBucketVersioning(): Promise<string> {
    throw new Error('HDFS not implemented');
  }

  getBucketLifecycleRules(): Promise<LifecycleRule[]> {
    throw new Error('HDFS not implemented');
  }

  getBucketTags(): Promise<Record<string, string>> {
    throw new Error('HDFS not implemented');
  }

  getBucketAcl(): Promise<BucketAcl> {
    throw new Error('HDFS not implemented');
  }
}
