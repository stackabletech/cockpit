import { eq, and, desc } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { storageDownloadManifests, userStorageConnections } from '$lib/server/schema.js';
import { encrypt } from './encryption.js';
import { storageEncryptionKey } from './encryption-key.js';
import { logger } from '$lib/server/logging';
import type { StorageConnectionConfig } from './types.js';
import type { ConnectionListItem } from '$lib/storage/connection-store.svelte.js';
import {
  decryptPayload,
  payloadType,
  toEndpoint,
  payloadFingerprint,
  toConnectionConfig,
  toStoredPayload,
  type StorageIdentity
} from './connection-payload.js';

const log = logger.child({ module: 'connections-db' });

/**
 * Save a storage connection for a user. If a connection with an identical
 * fingerprint already exists, return its existing ID without inserting.
 * The connection name is auto-generated from the hostname.
 * `devUser` is the HDFS user entered in no-OIDC dev mode; it is never set with SSO.
 * Returns the connection ID.
 */
export async function saveConnection(
  userId: string,
  config: StorageConnectionConfig,
  devUser?: string
): Promise<string> {
  const key = storageEncryptionKey();
  const payload = toStoredPayload(config, devUser);
  const fp = payloadFingerprint(payload, key);

  // Reuse existing connection if credentials are identical.
  const existing = await db
    .select({ id: userStorageConnections.id })
    .from(userStorageConnections)
    .where(and(eq(userStorageConnections.userId, userId), eq(userStorageConnections.hash, fp)))
    .limit(1);

  if (existing.length > 0) {
    log.debug({ connection_id: existing[0].id }, 'reusing existing storage connection');
    return existing[0].id;
  }

  const encryptedPayload = encrypt(JSON.stringify(payload), key);

  // Auto-generate name from hostname.
  let baseName = config.host;
  if (!baseName) baseName = config.type === 'hdfs' ? 'HDFS' : 'S3';

  // Insert, appending a numeric suffix on name collisions.
  let name = baseName;
  for (let suffix = 2; suffix <= 99; suffix++) {
    try {
      const [inserted] = await db
        .insert(userStorageConnections)
        .values({ userId, name, encryptedPayload, hash: fp, additionalBuckets: [] })
        .returning({ id: userStorageConnections.id });
      log.info(
        { connection_id: inserted.id, storage_type: config.type },
        'storage connection saved'
      );
      return inserted.id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('user_storage_connections_user_id_name_unique')) {
        name = `${baseName} ${suffix}`;
        continue;
      }
      throw err;
    }
  }

  throw new Error('Could not generate a unique connection name');
}

/**
 * Retrieve and decrypt the config for a specific connection belonging to a user.
 * Returns null if the connection does not exist or does not belong to the user.
 */
export async function getConnectionForUser(
  identity: StorageIdentity,
  connectionId: string
): Promise<StorageConnectionConfig | null> {
  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(
      and(
        eq(userStorageConnections.id, connectionId),
        eq(userStorageConnections.userId, identity.userId)
      )
    )
    .limit(1);

  if (rows.length === 0) return null;

  let payload;
  try {
    payload = decryptPayload(rows[0].encryptedPayload, storageEncryptionKey());
  } catch (err) {
    log.error({ err, connection_id: connectionId }, 'failed to decrypt storage connection');
    return null;
  }
  return toConnectionConfig(payload, (rows[0].additionalBuckets as string[]) ?? [], identity);
}

/** Whether a connection exists and belongs to the user, without decrypting it. */
export async function connectionBelongsToUser(
  userId: string,
  connectionId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: userStorageConnections.id })
    .from(userStorageConnections)
    .where(
      and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * List a user's saved connections, most recently used first. Only the type and
 * display endpoint are decrypted; credentials never leave this function.
 */
export async function listConnectionItems(userId: string): Promise<ConnectionListItem[]> {
  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(eq(userStorageConnections.userId, userId))
    .orderBy(desc(userStorageConnections.updatedAt));

  const key = storageEncryptionKey();
  return rows.map((row) => {
    let endpoint: string | null = null;
    let type: ConnectionListItem['type'] = 's3';
    try {
      const payload = decryptPayload(row.encryptedPayload, key);
      endpoint = toEndpoint(payload);
      type = payloadType(payload);
    } catch {
      // Return entry without endpoint if decryption fails.
    }
    return {
      id: row.id,
      name: row.name,
      type,
      endpoint,
      additionalBuckets: (row.additionalBuckets as string[]) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  });
}

/**
 * Delete a storage connection belonging to a user.
 */
export async function deleteConnection(userId: string, connectionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(storageDownloadManifests)
      .where(
        and(
          eq(storageDownloadManifests.connectionId, connectionId),
          eq(storageDownloadManifests.userId, userId)
        )
      );
    await tx
      .delete(userStorageConnections)
      .where(
        and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
      );
  });
  log.info({ connection_id: connectionId }, 'storage connection deleted');
}
