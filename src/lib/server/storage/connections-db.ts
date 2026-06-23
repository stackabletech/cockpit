import { eq, and, desc } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { encrypt, decrypt, connectionFingerprint } from './encryption.js';
import type { S3ConnectionConfig, ConnectionMetadata } from './types.js';

/**
 * Generate a human-readable display name for a connection.
 * Uses the S3 endpoint hostname, or "AWS S3" when no endpoint is set.
 */
export function connectionLabel(endpoint?: string): string {
  if (endpoint) {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return endpoint;
    }
  }
  return 'AWS S3';
}

/**
 * List all saved connections for a user, ordered by most recently updated.
 * Never returns credentials — only metadata safe for display.
 */
export async function listUserConnections(userId: string): Promise<ConnectionMetadata[]> {
  const rows = await db
    .select({
      id: userStorageConnections.id,
      name: userStorageConnections.name,
      type: userStorageConnections.type,
      endpoint: userStorageConnections.endpoint,
      updatedAt: userStorageConnections.updatedAt
    })
    .from(userStorageConnections)
    .where(eq(userStorageConnections.userId, userId))
    .orderBy(desc(userStorageConnections.updatedAt));

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as 's3',
    endpoint: r.endpoint ?? undefined,
    updatedAt: r.updatedAt
  }));
}

/**
 * Save a connection for a user, upserting on hash (type + endpoint + accessKeyId).
 * Returns the UUID of the saved connection.
 */
export async function saveConnection(userId: string, config: S3ConnectionConfig): Promise<string> {
  const name = connectionLabel(config.endpoint);
  const hash = connectionFingerprint(
    userId,
    config.type,
    config.endpoint ?? '',
    config.accessKeyId ?? ''
  );
  const encryptedPayload = encrypt(JSON.stringify(config));
  const endpoint = config.endpoint ?? null;
  const now = new Date();

  const existing = await db
    .select({ id: userStorageConnections.id })
    .from(userStorageConnections)
    .where(and(eq(userStorageConnections.userId, userId), eq(userStorageConnections.hash, hash)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(userStorageConnections)
      .set({ encryptedPayload, endpoint, updatedAt: now })
      .where(eq(userStorageConnections.id, existing[0].id));
    return existing[0].id;
  }

  const inserted = await db
    .insert(userStorageConnections)
    .values({
      userId,
      name,
      type: config.type,
      endpoint,
      encryptedPayload,
      hash,
      additionalBuckets: []
    })
    .returning({ id: userStorageConnections.id });

  return inserted[0].id;
}

/**
 * Delete a connection, scoped to the owning user. No-op if not found.
 */
export async function deleteConnection(userId: string, connectionId: string): Promise<void> {
  await db
    .delete(userStorageConnections)
    .where(
      and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
    );
}

/**
 * Retrieve and decrypt a connection for a user.
 * Returns null if not found or if the connection belongs to a different user.
 */
export async function getConnectionForUser(
  userId: string,
  connectionId: string
): Promise<S3ConnectionConfig | null> {
  const rows = await db
    .select({ encryptedPayload: userStorageConnections.encryptedPayload })
    .from(userStorageConnections)
    .where(
      and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
    )
    .limit(1);

  if (rows.length === 0) return null;

  try {
    const config = JSON.parse(decrypt(rows[0].encryptedPayload)) as S3ConnectionConfig;
    return config;
  } catch {
    // Corrupted or tampered payload — treat as not found
    return null;
  }
}
