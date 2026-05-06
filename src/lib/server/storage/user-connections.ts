import type { S3ConnectionConfig } from './types.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-user-connections' });

const userConnections = new Map<string, S3ConnectionConfig>();

export function setUserConnection(userId: string, config: S3ConnectionConfig): void {
  userConnections.set(userId, config);
  log.info({ user_id: userId, storage_type: config.type }, 'user storage connection saved');
}

export function getUserConnection(userId: string): S3ConnectionConfig | null {
  return userConnections.get(userId) ?? null;
}

export function clearUserConnection(userId: string): void {
  userConnections.delete(userId);
  log.info({ user_id: userId }, 'user storage connection cleared');
}
