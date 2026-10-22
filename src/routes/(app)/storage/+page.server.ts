import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { desc, eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import type { Infer, InferIn } from 'sveltekit-superforms';
import {
  StorageConnectionSchema,
  ConnectionIdSchema,
  StoredStorageConnectionSchema,
  type StorageConnectionMessage
} from '$lib/storage/schemas.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import { connectionTestErrorMessage } from '$lib/server/storage/connection-test-error.js';
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
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import type { ConnectionMetadata } from '$lib/storage/connection-types.js';
import * as m from '$lib/paraglide/messages.js';

type ConnectionData = Infer<typeof StorageConnectionSchema>;
type ConnectionInput = InferIn<typeof StorageConnectionSchema>;

export const load: PageServerLoad = async ({ locals }) => {
  const log = locals.logger;
  const connectionForm = await superValidate<
    ConnectionData,
    StorageConnectionMessage,
    ConnectionInput
  >({ tls: { verification: 'Full' } }, zod(StorageConnectionSchema), { errors: false });
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
        const payload = StoredStorageConnectionSchema.parse(
          JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey()))
        );
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
    const form = await superValidate<ConnectionData, StorageConnectionMessage, ConnectionInput>(
      request,
      zod(StorageConnectionSchema)
    );

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection form validation failed');
      return fail(400, { form });
    }

    const { type, host, port, tls, accessStyle, region, credentials } = form.data;

    if (type !== 's3') {
      return message(
        form,
        { type: 'error', message: m.storage_connect_error_hdfs() },
        { status: 400 }
      );
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
      return message(
        form,
        { type: 'error', message: connectionTestErrorMessage(err) },
        { status: 400 }
      );
    }

    try {
      const id = await saveConnection(locals.user!.id, config);
      await auth.api.updateSession({
        headers: request.headers,
        body: { activeStorageConnectionId: id }
      });
    } catch (err) {
      log.error({ err }, 'failed to save storage connection');
      return message(
        form,
        { type: 'error', message: m.storage_connect_save_failed() },
        { status: 500 }
      );
    }

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
      log.debug({ errors: form.errors }, 'invalid connection id for use');
      return fail(400, { error: m.storage_connection_edit_not_found() });
    }

    const { connectionId } = form.data;
    const userId = locals.user!.id;

    try {
      const config = await getConnectionForUser(userId, connectionId);
      if (!config) {
        log.debug({ connection_id: connectionId }, 'storage connection to use not found');
        return fail(400, { error: m.storage_connection_edit_not_found() });
      }

      try {
        await getConnectionProvider(config).listContainers();
      } catch (err) {
        log.warn({ err, connection_id: connectionId }, 'storage connection test failed on use');
        return fail(400, { error: m.storage_connect_error_unreachable() });
      }

      await auth.api.updateSession({
        headers: request.headers,
        body: { activeStorageConnectionId: connectionId }
      });
      log.info({ connection_id: connectionId }, 'user switched storage connection');
    } catch (err) {
      log.error({ err, connection_id: connectionId }, 'failed to switch storage connection');
      return fail(500, { error: m.storage_connect_error() });
    }

    throw redirect(303, '/storage');
  },

  deleteConnection: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(ConnectionIdSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'invalid connection id for delete');
      return fail(400, { error: m.storage_connection_edit_not_found() });
    }

    const { connectionId } = form.data;
    const userId = locals.user!.id;
    const activeId = locals.session?.activeStorageConnectionId ?? null;

    try {
      if (connectionId === activeId) {
        await auth.api.updateSession({
          headers: request.headers,
          body: { activeStorageConnectionId: null }
        });
        log.info(
          { connection_id: connectionId },
          'active storage connection deleted, session cleared'
        );
      }

      await deleteConnection(userId, connectionId);
      log.info({ connection_id: connectionId }, 'storage connection deleted');
    } catch (err) {
      log.error({ err, connection_id: connectionId }, 'failed to delete storage connection');
      return fail(500, { error: m.storage_connections_delete_failed() });
    }

    throw redirect(303, '/storage');
  }
};
