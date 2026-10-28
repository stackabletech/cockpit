import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { desc, eq } from 'drizzle-orm';
import { StoredStorageConnectionSchema } from '$lib/storage/schemas.js';
import { deleteConnectionAction } from '$lib/server/storage/delete-connection-action.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt } from '$lib/server/storage/encryption.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import type { ConnectionListItem } from '$lib/storage/connection-store.svelte.js';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading storage connections management page');

  const userId = locals.user?.id;
  if (!userId) return { connections: [] as ConnectionListItem[] };

  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(eq(userStorageConnections.userId, userId))
    .orderBy(desc(userStorageConnections.updatedAt));

  const connections: ConnectionListItem[] = rows.map((row) => {
    let endpoint: string | null = null;
    try {
      const payload = StoredStorageConnectionSchema.parse(
        JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey()))
      );
      endpoint =
        payload.host && payload.port ? `${payload.host}:${payload.port}` : (payload.host ?? null);
    } catch (err) {
      locals.logger.warn({ err, connection_id: row.id }, 'failed to decrypt storage connection');
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

  return { connections };
};

export const actions: Actions = {
  deleteConnection: async (event) => {
    const failure = await deleteConnectionAction(event);
    if (failure) return failure;
    throw redirect(303, '/settings/connections');
  }
};
