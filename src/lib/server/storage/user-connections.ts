import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
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

/** List all buckets accessible with the user's current connection. Throws on connectivity error. */
export async function listBucketsForUser(userId: string): Promise<string[]> {
  const config = getUserConnection(userId);
  if (!config) return [];

  const client = new S3Client({
    region: config.region,
    ...(config.endpoint && {
      endpoint: config.endpoint,
      forcePathStyle: true
    }),
    ...(config.accessKeyId &&
      config.secretAccessKey && {
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      })
  });

  const output = await client.send(new ListBucketsCommand({}));
  const buckets = (output.Buckets ?? []).map((b) => b.Name ?? '').filter(Boolean);
  log.debug({ user_id: userId, bucket_count: buckets.length }, 'listed buckets');
  return buckets;
}
