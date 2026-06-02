import type { StorageConnectionConfig, S3ConnectionConfig } from './types.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'storage-user-connections' });

// ── Connection fingerprint ────────────────────────────────────────────────────

/** djb2 hash — fast, synchronous, no dependencies. */
function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = Math.imul(hash, 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Derives a stable, short identifier for a connection from its non-secret
 * fields (type, endpoint/host, access key ID). Used to scope persisted tab
 * state per connection so switching connections does not surface tabs from
 * a different one.
 */
export function deriveConnectionId(config: StorageConnectionConfig): string {
  const parts =
    config.type === 's3'
      ? ['s3', config.endpoint ?? '', config.accessKeyId ?? '']
      : ['hdfs', config.nameNode, String(config.port), config.user];
  return djb2(parts.join('\x00'));
}

// ── Per-user connection store ─────────────────────────────────────────────────

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
