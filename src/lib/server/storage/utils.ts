import { error } from '@sveltejs/kit';
import { StorageProviderFactory } from './factory.js';
import type { StorageProvider } from './provider.js';
import type { StorageConfig, StorageConnectionConfig } from './types.js';
import { storageHdfsEnabled } from '$lib/server/feature-flags.js';

function assertSupported(config: StorageConfig | StorageConnectionConfig): void {
  if (config.type === 'hdfs' && !storageHdfsEnabled) {
    throw error(400, 'HDFS connections are not enabled');
  }
}

/**
 * Construct a bucket-scoped storage provider from the given connection config.
 * For HDFS, `bucket` is the absolute base path.
 * Throws a 400 HTTP error if the connection type is not enabled.
 */
export function getProvider(
  config: StorageConfig | StorageConnectionConfig,
  bucket: string
): StorageProvider {
  assertSupported(config);
  return StorageProviderFactory.create({ ...config, bucket });
}

/**
 * Construct a connection-scoped storage provider for operations that do not
 * require a specific bucket (e.g. listing all buckets). HDFS providers are
 * scoped to `/`.
 * Throws a 400 HTTP error if the connection type is not enabled.
 */
export function getConnectionProvider(
  config: StorageConfig | StorageConnectionConfig
): StorageProvider {
  assertSupported(config);
  return StorageProviderFactory.create({
    ...config,
    bucket: config.type === 'hdfs' ? '/' : ''
  } as StorageConfig);
}
