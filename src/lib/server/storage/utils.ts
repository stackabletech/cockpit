import { error } from '@sveltejs/kit';
import { StorageProviderFactory } from './factory.js';
import type { StorageProvider } from './provider.js';
import type { StorageConfig } from './types.js';

/**
 * Construct a bucket-scoped storage provider from the given connection config.
 * Throws a 400 HTTP error if the connection type is not supported.
 */
export function getProvider(config: StorageConfig, bucket: string): StorageProvider {
  if (config.type !== 's3') {
    throw error(400, 'Storage backend not supported');
  }

  return StorageProviderFactory.create({ ...config, bucket });
}

/**
 * Construct a connection-scoped storage provider for operations that do not
 * require a specific bucket (e.g. listing all buckets).
 * Throws a 400 HTTP error if the connection type is not supported.
 */
export function getConnectionProvider(config: StorageConfig): StorageProvider {
  if (config.type !== 's3') {
    throw error(400, 'Storage backend not supported');
  }

  return StorageProviderFactory.create({ ...config, bucket: '' });
}
