import { fail, redirect, isHttpError } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { desc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { StorageConnectionSchema, ConnectionIdSchema } from '$lib/storage/schemas.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import {
  saveConnection,
  getConnectionForUser,
  deleteConnection
} from '$lib/server/storage/connections-db.js';
import { auth } from '$lib/server/auth.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt } from '$lib/server/storage/encryption.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import type { ConnectionMetadata, S3ConnectionConfig } from '$lib/server/storage/types.js';
import * as m from '$lib/paraglide/messages.js';

export const load: PageServerLoad = async ({ locals }) => {
  const log = locals.logger;
  const connectionForm = await superValidate(
    { tls: { verification: 'Full' } },
    zod(StorageConnectionSchema),
    { errors: false }
  );
  log.debug('loading storage page');

  const userId = locals.user?.id;
  let connections: ConnectionMetadata[] = [];

  if (userId) {
    const rows = await db
      .select()
      .from(userStorageConnections)
      .where(eq(userStorageConnections.userId, userId))
      .orderBy(desc(userStorageConnections.updatedAt));

    connections = rows.map((row) => {
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
      return { id: row.id, name: row.name, endpoint };
    });
  }

  return { connectionForm, connections };
};

export const actions: Actions = {
  connect: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(StorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection form validation failed');
      return fail(400, { form });
    }

    const { type, host, port, tls, accessStyle, region, credentials } = form.data;

    if (type !== 's3') {
      return message(form, m.storage_connect_error_hdfs(), { status: 400 });
    }

    const resolvedCredentials =
      credentials.accessKey && credentials.secretKey ? credentials : undefined;

    const config: S3ConnectionConfig = {
      type: 's3',
      host,
      port,
      tls,
      accessStyle,
      region,
      credentials: resolvedCredentials
    };

    try {
      await getConnectionProvider(config).listContainers();
      log.info({ storage_type: type }, 'user storage connection verified');
    } catch (err) {
      log.warn({ err }, 'storage connection test failed');

      let msg: string;
      if (isHttpError(err)) {
        if (err.status === 403) {
          msg = m.storage_connect_error_access_denied();
        } else if (err.status === 404) {
          msg = m.storage_connect_error_not_found();
        } else if (err.status === 502) {
          msg = m.storage_connect_error_server_error();
        } else {
          msg = m.storage_connect_error();
        }
      } else if (err instanceof Error) {
        const e = (err.message ?? '').toLowerCase();
        if (/econnrefused|enotfound|eai_again|etimedout|network/.test(e)) {
          msg = m.storage_connect_error_network();
        } else {
          msg = m.storage_connect_error();
        }
      } else {
        msg = m.storage_connect_error();
      }

      return message(form, msg, { status: 400 });
    }

    const id = await saveConnection(locals.user!.id, config);
    await auth.api.updateSession({
      headers: request.headers,
      body: { activeStorageConnectionId: id }
    });

    throw redirect(303, '/storage');
  },

  disconnect: async ({ request, locals }) => {
    locals.logger.info('user storage connection cleared');
    await auth.api.updateSession({
      headers: request.headers,
      body: { activeStorageConnectionId: null }
    });
    throw redirect(303, '/storage');
  },

  use: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(ConnectionIdSchema));

    if (!form.valid) {
      return fail(400, { error: 'Invalid connection ID' });
    }

    const { connectionId } = form.data;
    const userId = locals.user!.id;

    const config = await getConnectionForUser(userId, connectionId);
    if (!config) {
      return fail(400, { error: 'Connection not found' });
    }

    try {
      await getConnectionProvider(config).listContainers();
      log.info({ connectionId }, 'user switched storage connection');
    } catch (err) {
      log.warn({ err, connectionId }, 'storage connection test failed on use');
      return fail(400, { error: 'Could not connect — check the endpoint and credentials.' });
    }

    await auth.api.updateSession({
      headers: request.headers,
      body: { activeStorageConnectionId: connectionId }
    });

    throw redirect(303, '/storage');
  },

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

    throw redirect(303, '/storage');
  }
};
