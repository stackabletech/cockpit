import { error, fail, redirect } from '@sveltejs/kit';
import { superValidate, message, setError } from 'sveltekit-superforms';
import type { Infer, InferIn } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { eq, and } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import {
  EditStorageConnectionSchema,
  StoredStorageConnectionSchema,
  type StorageConnectionMessage
} from '$lib/storage/schemas.js';
import type { z } from 'zod';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import { connectionTestErrorMessage } from '$lib/server/storage/connection-test-error.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt, encrypt, fingerprint } from '$lib/server/storage/encryption.js';
import { isConnectionNameConflict } from '$lib/server/storage/connections-db.js';
import { deleteConnectionAction } from '$lib/server/storage/delete-connection-action.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import * as m from '$lib/paraglide/messages.js';

type EditData = Infer<typeof EditStorageConnectionSchema>;
type EditInput = InferIn<typeof EditStorageConnectionSchema>;

export const load: PageServerLoad = async ({ locals, params }) => {
  const userId = locals.user!.id;

  const rows = await db
    .select()
    .from(userStorageConnections)
    .where(and(eq(userStorageConnections.id, params.id), eq(userStorageConnections.userId, userId)))
    .limit(1);

  if (rows.length === 0) {
    locals.logger.debug({ connection_id: params.id }, 'connection not found, redirecting');
    throw redirect(303, '/settings/connections');
  }

  const row = rows[0];
  let payload: z.infer<typeof StoredStorageConnectionSchema>;

  try {
    payload = StoredStorageConnectionSchema.parse(
      JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey()))
    );
  } catch {
    locals.logger.error({ connection_id: params.id }, 'failed to decrypt connection payload');
    throw error(500, 'Failed to load connection');
  }

  const editForm = await superValidate<EditData, StorageConnectionMessage, EditInput>(
    {
      id: params.id,
      name: row.name ?? '',
      type: 's3',
      host: payload.host,
      port: payload.port,
      tls: payload.tls,
      accessStyle: payload.accessStyle,
      region: payload.region,
      credentials: {
        accessKey: payload.credentials?.accessKey ?? '',
        secretKey: ''
      }
    },
    zod(EditStorageConnectionSchema),
    { errors: false }
  );

  locals.logger.debug({ connection_id: params.id }, 'loading storage connection edit page');
  return {
    editForm,
    connectionId: params.id,
    activeConnectionId: locals.session?.activeStorageConnectionId ?? null
  };
};

export const actions: Actions = {
  update: async ({ request, locals, params }) => {
    const log = locals.logger;
    const form = await superValidate<EditData, StorageConnectionMessage, EditInput>(
      request,
      zod(EditStorageConnectionSchema)
    );

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection edit form validation failed');
      return fail(400, { form });
    }

    const { type, host, port, tls, accessStyle, region, credentials } = form.data;
    const connectionId = params.id;
    const userId = locals.user!.id;

    if (type !== 's3') {
      return message(
        form,
        { type: 'error', message: m.storage_connect_error_hdfs() },
        { status: 400 }
      );
    }

    let existing: z.infer<typeof StoredStorageConnectionSchema>;
    let storedFingerprint: string;
    try {
      const rows = await db
        .select({
          encryptedPayload: userStorageConnections.encryptedPayload,
          hash: userStorageConnections.hash
        })
        .from(userStorageConnections)
        .where(
          and(
            eq(userStorageConnections.id, connectionId),
            eq(userStorageConnections.userId, userId)
          )
        )
        .limit(1);
      if (rows.length === 0) {
        log.debug({ connection_id: connectionId }, 'storage connection to update not found');
        return message(
          form,
          { type: 'error', message: m.storage_connection_edit_not_found() },
          { status: 404 }
        );
      }
      existing = StoredStorageConnectionSchema.parse(
        JSON.parse(decrypt(rows[0].encryptedPayload, storageEncryptionKey()))
      );
      storedFingerprint = rows[0].hash;
    } catch (err) {
      log.error(
        { err, connection_id: connectionId },
        'failed to load storage connection to update'
      );
      return message(
        form,
        { type: 'error', message: m.storage_connect_save_failed() },
        { status: 500 }
      );
    }

    // Blank credentials keep the stored ones; a new access key needs its secret key.
    const newCredentials = credentials.accessKey && credentials.secretKey ? credentials : undefined;
    if (
      !newCredentials &&
      credentials.accessKey &&
      credentials.accessKey !== existing.credentials?.accessKey
    ) {
      log.debug({ connection_id: connectionId }, 'access key changed without a secret key');
      return setError(form, 'credentials.secretKey', m.storage_connection_edit_secret_required());
    }
    const resolvedCredentials = newCredentials ?? existing.credentials;

    const config: S3ConnectionConfig = {
      type: 's3',
      host,
      port,
      tls,
      accessStyle,
      region,
      credentials: resolvedCredentials?.accessKey ? resolvedCredentials : undefined
    };

    const payload: z.infer<typeof StoredStorageConnectionSchema> = {
      host,
      port,
      tls,
      accessStyle,
      region,
      credentials: resolvedCredentials
    };
    const encryptedPayload = encrypt(JSON.stringify(payload), storageEncryptionKey());
    const newFingerprint = fingerprint(
      {
        endpoint: host,
        port,
        tls,
        accessStyle,
        region: region.name,
        accessKeyId: payload.credentials?.accessKey ?? '',
        secretAccessKey: payload.credentials?.secretKey ?? ''
      },
      storageEncryptionKey()
    );

    // Only test the connection when the endpoint or credentials changed: a rename must not fail
    // because the backend is down at the moment.
    if (newFingerprint === storedFingerprint) {
      log.debug({ connection_id: connectionId }, 'connection settings unchanged, skipping test');
    } else {
      try {
        await getConnectionProvider(config).listContainers();
        log.info({ connection_id: connectionId }, 'storage connection edit verified');
      } catch (err) {
        log.warn({ err, connection_id: connectionId }, 'storage connection edit test failed');
        return message(
          form,
          { type: 'error', message: connectionTestErrorMessage(err) },
          { status: 400 }
        );
      }
    }

    // A blank name keeps the current one; the name column is required.
    const name = form.data.name?.trim() || undefined;
    try {
      await db
        .update(userStorageConnections)
        .set({ encryptedPayload, hash: newFingerprint, name })
        .where(
          and(
            eq(userStorageConnections.id, connectionId),
            eq(userStorageConnections.userId, userId)
          )
        );
    } catch (err) {
      if (name !== undefined && isConnectionNameConflict(err)) {
        log.debug({ connection_id: connectionId }, 'storage connection name already in use');
        return setError(form, 'name', m.storage_connection_edit_name_taken());
      }
      log.error({ err, connection_id: connectionId }, 'failed to update storage connection');
      return message(
        form,
        { type: 'error', message: m.storage_connect_save_failed() },
        { status: 500 }
      );
    }

    log.info({ connection_id: connectionId }, 'storage connection updated');

    return message(form, { type: 'success' });
  },

  // The connection sidebar on this page posts its delete forms here.
  deleteConnection: async (event) => {
    const failure = await deleteConnectionAction(event);
    if (failure) return failure;
    throw redirect(303, '/settings/connections');
  }
};
