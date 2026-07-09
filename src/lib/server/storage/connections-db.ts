import { eq, and } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { encrypt, decrypt, fingerprint } from './encryption.js';
import { storageEncryptionKey } from './encryption-key.js';
import { logger } from '$lib/server/logging';
import type { S3ConnectionConfig } from './types.js';

const log = logger.child({ module: 'connections-db' });

/** Stored payload shape inside encrypted_payload. */
interface StoredPayload {
  host: string;
  port?: number;
  tls?: { verification: 'Full' | 'None' };
  accessStyle: 'Path' | 'VirtualHosted';
  region: { name: string };
  credentials?: { accessKey: string; secretKey: string };
}

/**
 * Save an S3 connection for a user. If a connection with identical credentials
 * already exists (same fingerprint), return its existing ID without inserting.
 * The connection name is auto-generated from the hostname.
 * Returns the connection ID.
 */
export async function saveConnection(userId: string, config: S3ConnectionConfig): Promise<string> {
  const key = storageEncryptionKey();

  const fp = fingerprint(
    {
      endpoint: config.host,
      region: config.region.name,
      accessKeyId: config.credentials?.accessKey || '',
      secretAccessKey: config.credentials?.secretKey || ''
    },
    key
  );

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

  const payload: StoredPayload = {
    host: config.host,
    port: config.port,
    tls: config.tls,
    accessStyle: config.accessStyle,
    region: config.region,
    credentials: config.credentials
  };
  const encryptedPayload = encrypt(JSON.stringify(payload), key);

  // Auto-generate name from hostname.
  let baseName = config.host;
  if (!baseName) baseName = 'S3';

  // Insert, appending a numeric suffix on name collisions.
  let name = baseName;
  for (let suffix = 2; suffix <= 99; suffix++) {
    try {
      const [inserted] = await db
        .insert(userStorageConnections)
        .values({ userId, name, encryptedPayload, hash: fp, additionalBuckets: [] })
        .returning({ id: userStorageConnections.id });
      log.info({ connection_id: inserted.id }, 'storage connection saved');
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
 * Retrieve and decrypt the S3 config for a specific connection belonging to a user.
 * Returns null if the connection does not exist or does not belong to the user.
 */
export async function getConnectionForUser(
  userId: string,
  connectionId: string
): Promise<S3ConnectionConfig | null> {
  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(
      and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
    )
    .limit(1);

  if (rows.length === 0) return null;

  try {
    const payload = JSON.parse(
      decrypt(rows[0].encryptedPayload, storageEncryptionKey())
    ) as StoredPayload;
    return {
      type: 's3',
      host: payload.host,
      port: payload.port,
      tls: payload.tls,
      accessStyle: payload.accessStyle,
      region: payload.region,
      credentials: payload.credentials?.accessKey ? payload.credentials : undefined
    };
  } catch (err) {
    log.error({ err, connection_id: connectionId }, 'failed to decrypt storage connection');
    return null;
  }
}

/**
 * Delete a storage connection belonging to a user.
 */
export async function deleteConnection(userId: string, connectionId: string): Promise<void> {
  await db
    .delete(userStorageConnections)
    .where(
      and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
    );
  log.info({ connection_id: connectionId }, 'storage connection deleted');
}
