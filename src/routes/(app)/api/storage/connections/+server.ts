import { desc, eq, and } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
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
        host?: string;
        port?: number;
      };
      endpoint =
        payload.host && payload.port ? `${payload.host}:${payload.port}` : (payload.host ?? null);
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

/**
 * PATCH /api/storage/connections
 *
 * Adds a bucket to the active connection's `additionalBuckets` list.
 * Requires the `x-storage-connection-id` header. The bucket is only added
 * if the caller has already verified access (e.g. via check-bucket).
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
  const userId = locals.user!.id;
  const connectionId = request.headers.get(STORAGE_CONNECTION_ID_HEADER);
  if (!connectionId) {
    return json({ error: 'Missing storage connection ID' }, { status: 400 });
  }

  const body = (await request.json()) as { bucket?: string };
  const bucket = body.bucket?.trim();
  if (!bucket) {
    return json({ error: 'Bucket name is required' }, { status: 400 });
  }

  const rows = await db
    .select({
      id: userStorageConnections.id,
      additionalBuckets: userStorageConnections.additionalBuckets
    })
    .from(userStorageConnections)
    .where(
      and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
    )
    .limit(1);

  if (rows.length === 0) {
    return json({ error: 'Connection not found' }, { status: 404 });
  }

  const existing = (rows[0].additionalBuckets as string[]) ?? [];
  if (existing.includes(bucket)) {
    return json({ ok: true });
  }

  const updated = [...existing, bucket];
  await db
    .update(userStorageConnections)
    .set({ additionalBuckets: updated, updatedAt: new Date() })
    .where(eq(userStorageConnections.id, connectionId));

  locals.logger.info({ connection_id: connectionId, bucket }, 'bucket added to connection');
  return json({ ok: true });
};
