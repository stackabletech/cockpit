import { error } from '@sveltejs/kit';
import { getUserConnection } from './user-connections.js';
import { StorageProviderFactory } from './factory.js';
import type { StorageProvider } from './provider.js';

export function getProviderForUser(userId: string, bucket: string): StorageProvider {
  const connection = getUserConnection(userId);
  if (!connection) {
    throw error(401, 'No storage connection configured');
  }

  if (connection.type !== 's3') {
    throw error(400, 'Storage backend not supported');
  }

  return StorageProviderFactory.create({ ...connection, bucket });
}
