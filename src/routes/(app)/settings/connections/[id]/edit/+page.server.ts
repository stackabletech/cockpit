import { error, fail, redirect, isHttpError } from '@sveltejs/kit';
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
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt, encrypt, fingerprint } from '$lib/server/storage/encryption.js';
import { isConnectionNameConflict } from '$lib/server/storage/connections-db.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import { logger } from '$lib/server/logging';
import * as m from '$lib/paraglide/messages.js';

type EditData = Infer<typeof EditStorageConnectionSchema>;
type EditInput = InferIn<typeof EditStorageConnectionSchema>;

const log = logger.child({ module: 'connection-edit' });

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

    if (resolvedCredentials) {
      try {
        await getConnectionProvider(config).listContainers();
        log.info({ storage_type: type }, 'storage connection edit verified');
      } catch (err) {
        log.warn({ err }, 'storage connection edit test failed');

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

        return message(form, { type: 'error', message: msg }, { status: 400 });
      }
    }

    // If no new credentials were provided, preserve the existing encrypted ones.
    let payload: z.infer<typeof StoredStorageConnectionSchema>;
    if (resolvedCredentials) {
      payload = { host, port, tls, accessStyle, region, credentials: resolvedCredentials };
    } else {
      try {
        const rows = await db
          .select({ encryptedPayload: userStorageConnections.encryptedPayload })
          .from(userStorageConnections)
          .where(
            and(
              eq(userStorageConnections.id, connectionId),
              eq(userStorageConnections.userId, userId)
            )
          )
          .limit(1);
        if (rows.length === 0) {
          return message(
            form,
            { type: 'error', message: m.storage_connect_error_not_found() },
            { status: 404 }
          );
        }
        const existing = StoredStorageConnectionSchema.parse(
          JSON.parse(decrypt(rows[0].encryptedPayload, storageEncryptionKey()))
        );
        if (credentials.accessKey && credentials.accessKey !== existing.credentials?.accessKey) {
          log.debug({ connection_id: connectionId }, 'access key changed without a secret key');
          return setError(
            form,
            'credentials.secretKey',
            m.storage_connection_edit_secret_required()
          );
        }
        payload = { host, port, tls, accessStyle, region, credentials: existing.credentials };
      } catch {
        return message(
          form,
          { type: 'error', message: m.storage_connect_error() },
          { status: 500 }
        );
      }
    }

    const encryptedPayload = encrypt(JSON.stringify(payload), storageEncryptionKey());
    const hash = fingerprint(
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

    // A blank name keeps the current one; the name column is required.
    const name = form.data.name?.trim() || undefined;
    try {
      await db
        .update(userStorageConnections)
        .set({ encryptedPayload, hash, name })
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
      throw err;
    }

    log.info({ connection_id: connectionId }, 'storage connection updated');

    return message(form, { type: 'success' });
  }
};
