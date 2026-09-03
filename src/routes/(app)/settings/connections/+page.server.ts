import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { ConnectionIdSchema } from '$lib/storage/schemas.js';
import { deleteConnection } from '$lib/server/storage/connections-db.js';
import { auth } from '$lib/server/auth.js';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt } from '$lib/server/storage/encryption.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import type { ConnectionListItem } from '$lib/storage/connection-store.svelte.js';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading storage connections management page');
  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(eq(userStorageConnections.userId, locals.user!.id))
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
  deleteConnection: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(ConnectionIdSchema));

    if (!form.valid) {
      return fail(400, { error: 'Invalid connection ID' });
    }

    const { connectionId } = form.data;
    const userId = locals.user!.id;
    const activeId = locals.session?.activeStorageConnectionId ?? null;

    if (connectionId === activeId) {
      await auth.api.updateSession({
        headers: request.headers,
        body: { activeStorageConnectionId: null }
      });
      log.info({ connectionId }, 'active storage connection deleted, session cleared');
    }

    await deleteConnection(userId, connectionId);
    log.info({ connectionId }, 'storage connection deleted from management page');

    throw redirect(303, '/settings/connections');
  }
};
