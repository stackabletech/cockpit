import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt } from './encryption.js';
import { storageEncryptionKey } from './encryption-key.js';
import type { S3ConnectionConfig } from './types.js';
import { logger } from '$lib/server/logging';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import { StoredStorageConnectionSchema } from '$lib/storage/schemas.js';

const log = logger.child({ module: 'storage-connection' });

/** Minimum age of `updated_at` before a request refreshes it again. */
const LAST_USED_TOUCH_INTERVAL_MS = 5 * 60_000;

const AdditionalBucketsSchema = z.array(z.string());

/**
 * Look up a storage connection by UUID and authenticated user ID, decrypt the
 * payload, and return the {@link S3ConnectionConfig}.
 *
 * Also refreshes `updated_at` on the connection row (fire-and-forget) so that
 * connection lists are ordered most-recently-used first.
 * The write is skipped while `updated_at` is younger than
 * {@link LAST_USED_TOUCH_INTERVAL_MS}, so not every storage request hits the database.
 *
 * Returns `null` if the header is absent.
 * Throws 401 if the connection is not found or does not belong to the user.
 * Throws 500 if decryption fails or the payload does not match the stored schema.
 */
export async function getConnectionFromHeader(
  request: Request,
  userId: string
): Promise<S3ConnectionConfig | null> {
  const connectionId = request.headers.get(STORAGE_CONNECTION_ID_HEADER);
  if (!connectionId) return null;
  if (!z.uuid().safeParse(connectionId).success) throw error(400, 'Invalid storage connection ID');

  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(
      and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
    )
    .limit(1);

  if (rows.length === 0) {
    log.warn({ connection_id: connectionId }, 'storage connection not found or unauthorised');
    throw error(401, 'Storage connection not found');
  }

  const row = rows[0];

  let payload;
  try {
    payload = StoredStorageConnectionSchema.parse(
      JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey()))
    );
  } catch (err) {
    log.error(
      { err, connection_id: connectionId },
      'failed to decrypt or parse storage connection payload'
    );
    throw error(500, 'Failed to decrypt storage connection');
  }

  const additionalBuckets = AdditionalBucketsSchema.safeParse(row.additionalBuckets);
  if (!additionalBuckets.success) {
    log.warn({ connection_id: connectionId }, 'invalid additional buckets on storage connection');
  }

  // Update updated_at asynchronously — do not block the request on this.
  if (Date.now() - row.updatedAt.getTime() > LAST_USED_TOUCH_INTERVAL_MS) {
    log.debug({ connection_id: connectionId }, 'refreshing storage connection updated_at');
    db.update(userStorageConnections)
      .set({ updatedAt: new Date() })
      .where(eq(userStorageConnections.id, connectionId))
      .catch((err) =>
        log.warn({ err, connection_id: connectionId }, 'failed to update connection updated_at')
      );
  }

  const resolvedCredentials =
    payload.credentials?.accessKey && payload.credentials?.secretKey
      ? payload.credentials
      : undefined;

  return {
    type: 's3',
    host: payload.host,
    port: payload.port,
    tls: payload.tls,
    accessStyle: payload.accessStyle,
    region: payload.region,
    credentials: resolvedCredentials,
    additionalBuckets: additionalBuckets.success ? additionalBuckets.data : []
  };
}
