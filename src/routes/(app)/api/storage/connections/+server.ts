import { eq, and } from 'drizzle-orm';
import { json } from '@sveltejs/kit';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { listConnectionItems } from '$lib/server/storage/connections-db.js';
import { normaliseHdfsBasePath } from '$lib/storage/hdfs-path.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/connections
 *
 * Returns the authenticated user's saved storage connections, sorted by
 * most recently used first. Credentials are never included in the response.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const connections = await listConnectionItems(getUserId(locals));

  locals.logger.debug({ connection_count: connections.length }, 'connections list returned');
  return Response.json(connections);
};

/**
 * PATCH /api/storage/connections
 *
 * Adds a bucket (S3) or absolute base path (HDFS) to the active connection's
 * `additionalBuckets` list.
 * Requires the `x-storage-connection-id` header. The bucket is only added
 * if the caller has already verified access (e.g. via check-bucket).
 */
export const PATCH: RequestHandler = async ({ request, locals }) => {
  const userId = getUserId(locals);
  const connectionId = request.headers.get(STORAGE_CONNECTION_ID_HEADER);
  if (!connectionId) {
    return json({ error: 'Missing storage connection ID' }, { status: 400 });
  }

  const body = (await request.json()) as { bucket?: string };
  let bucket = body.bucket?.trim();
  if (!bucket) {
    return json({ error: 'Bucket name is required' }, { status: 400 });
  }
  if (locals.storageConfig?.type === 'hdfs') {
    const normalised = normaliseHdfsBasePath(bucket);
    if (!normalised) {
      return json({ error: 'HDFS base path must be absolute' }, { status: 400 });
    }
    bucket = normalised;
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
