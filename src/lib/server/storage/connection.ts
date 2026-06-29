import { error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt } from './encryption.js';
import { storageEncryptionKey } from './encryption-key.js';
import type { S3ConnectionConfig } from './types.js';
import { logger } from '$lib/server/logging';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';

const log = logger.child({ module: 'storage-connection' });

/** The shape of the JSON stored inside encrypted_payload. */
interface StoredPayload {
  endpoint?: string;
  pathStyle?: boolean;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
}

/**
 * Look up a storage connection by UUID and authenticated user ID, decrypt the
 * payload, and return the {@link S3ConnectionConfig}.
 *
 * Also updates `updated_at` on the connection row (fire-and-forget) so that
 * auto-connect picks the most-recently-used connection on the next page load.
 *
 * Returns `null` if the header is absent.
 * Throws 401 if the connection is not found or does not belong to the user.
 * Throws 500 if decryption fails.
 */
export async function getConnectionFromHeader(
  request: Request,
  userId: string
): Promise<S3ConnectionConfig | null> {
  const connectionId = request.headers.get(STORAGE_CONNECTION_ID_HEADER);
  if (!connectionId) return null;

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

  let payload: StoredPayload;
  try {
    payload = JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey())) as StoredPayload;
  } catch (err) {
    log.error({ err, connection_id: connectionId }, 'failed to decrypt storage connection payload');
    throw error(500, 'Failed to decrypt storage connection');
  }

  // Update updated_at asynchronously — do not block the request on this.
  db.update(userStorageConnections)
    .set({ updatedAt: new Date() })
    .where(eq(userStorageConnections.id, connectionId))
    .catch((err) =>
      log.warn({ err, connection_id: connectionId }, 'failed to update connection updated_at')
    );

  return {
    type: 's3',
    endpoint: payload.endpoint || undefined,
    pathStyle: payload.pathStyle ?? true,
    region: payload.region,
    accessKeyId: payload.accessKeyId || undefined,
    secretAccessKey: payload.secretAccessKey || undefined,
    additionalBuckets: (row.additionalBuckets as string[]) ?? []
  };
}
