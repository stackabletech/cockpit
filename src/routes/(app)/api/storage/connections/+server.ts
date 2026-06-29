import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/connections
 *
 * Returns the authenticated user's saved storage connections, sorted by
 * most recently used first. Credentials are never included in the response.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const userId = locals.user!.id;

  const rows = await db
    .select({
      id: userStorageConnections.id,
      name: userStorageConnections.name,
      encryptedPayload: userStorageConnections.encryptedPayload,
      additionalBuckets: userStorageConnections.additionalBuckets,
      createdAt: userStorageConnections.createdAt,
      updatedAt: userStorageConnections.updatedAt
    })
    .from(userStorageConnections)
    .where(eq(userStorageConnections.userId, userId))
    .orderBy(desc(userStorageConnections.updatedAt));

  // Decrypt the endpoint for display purposes — we include it in the response
  // so the UI can show a label, but never include the access keys or secret.
  const { decrypt } = await import('$lib/server/storage/encryption.js');
  const { storageEncryptionKey: getKey } = await import('$lib/server/storage/encryption-key.js');

  const connections = rows.map((row) => {
    let endpoint: string | null = null;
    try {
      const payload = JSON.parse(decrypt(row.encryptedPayload, getKey())) as {
        endpoint?: string;
      };
      endpoint = payload.endpoint ?? null;
    } catch {
      // If decryption fails for a row, we still return the entry without the endpoint.
    }
    return {
      id: row.id,
      name: row.name,
      endpoint,
      additionalBuckets: (row.additionalBuckets as string[]) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  });

  locals.logger.debug({ connection_count: connections.length }, 'connections list returned');
  return Response.json(connections);
};
