import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { desc, eq } from 'drizzle-orm';
import { ConnectionIdSchema } from '$lib/storage/schemas.js';
import { deleteConnection } from '$lib/server/storage/connections-db.js';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  getActiveStorageConnectionId,
  setActiveStorageConnectionId
} from '$lib/server/storage/active-connection.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt } from '$lib/server/storage/encryption.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import type { ConnectionListItem } from '$lib/storage/connection-store.svelte.js';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading storage connections management page');

  const userId = getUserId(locals);

  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(eq(userStorageConnections.userId, userId))
    .orderBy(desc(userStorageConnections.updatedAt));

  const connections: ConnectionListItem[] = rows.map((row) => {
    let endpoint: string | null = null;
    try {
      const payload = JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey())) as {
        host?: string;
        port?: number;
      };
      endpoint =
        payload.host && payload.port ? `${payload.host}:${payload.port}` : (payload.host ?? null);
    } catch {
      // Return entry without endpoint if decryption fails.
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
  deleteConnection: async ({ request, locals, cookies }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(ConnectionIdSchema));

    if (!form.valid) {
      return fail(400, { error: 'Invalid connection ID' });
    }

    const { connectionId } = form.data;
    const userId = getUserId(locals);
    const activeId = getActiveStorageConnectionId(locals, cookies);

    if (connectionId === activeId) {
      await setActiveStorageConnectionId({ request, locals, cookies }, null);
      log.info({ connectionId }, 'active storage connection deleted, session cleared');
    }

    await deleteConnection(userId, connectionId);
    log.info({ connectionId }, 'storage connection deleted from management page');

    throw redirect(303, '/settings/connections');
  }
};
