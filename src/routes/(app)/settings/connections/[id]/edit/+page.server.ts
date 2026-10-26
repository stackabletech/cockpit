import { error, fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { eq, and } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { EditStorageConnectionSchema } from '$lib/storage/schemas.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import {
  decryptPayload,
  payloadFingerprint,
  toStoredPayload,
  type StoredPayload
} from '$lib/server/storage/connection-payload.js';
import {
  buildConnectionConfig,
  connectionErrorMessage
} from '$lib/server/storage/connection-form.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { encrypt } from '$lib/server/storage/encryption.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { getActiveStorageConnectionId } from '$lib/server/storage/active-connection.js';
import { hdfsKerberosAvailable } from '$lib/server/feature-flags.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'connection-edit' });

export const load: PageServerLoad = async ({ locals, params, cookies }) => {
  const userId = getUserId(locals);

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
  let payload: StoredPayload;

  try {
    payload = decryptPayload(row.encryptedPayload, storageEncryptionKey());
  } catch {
    locals.logger.error({ connection_id: params.id }, 'failed to decrypt connection payload');
    throw error(500, 'Failed to load connection');
  }

  const editForm = await superValidate(
    payload.type === 'hdfs'
      ? {
          id: params.id,
          name: row.name ?? '',
          type: 'hdfs' as const,
          host: payload.nameNodes?.join(', ') ?? payload.host,
          port: payload.port,
          tls: payload.tls,
          devUser: payload.devUser ?? '',
          auth: payload.auth ?? 'simple',
          servicePrincipal: payload.servicePrincipal ?? ''
        }
      : {
          id: params.id,
          name: row.name ?? '',
          type: 's3' as const,
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
    hdfsUser: locals.user?.username ?? null,
    hdfsKerberosAvailable,
    activeConnectionId: getActiveStorageConnectionId(locals, cookies)
  };
};

export const actions: Actions = {
  update: async ({ request, locals, params }) => {
    const form = await superValidate(request, zod(EditStorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection edit form validation failed');
      return fail(400, { form });
    }

    const connectionId = params.id;
    const userId = getUserId(locals);

    const built = buildConnectionConfig(form.data, locals);
    if (!built.ok) {
      return message(form, built.message, { status: 400 });
    }
    const { config, devUser } = built;

    // S3 without new credentials keeps the stored ones and skips the check;
    // HDFS has no secrets, so it is always re-verified.
    const keepExistingCredentials = config.type === 's3' && !config.credentials;

    if (!keepExistingCredentials) {
      try {
        await getConnectionProvider(config).listContainers();
        log.info({ storage_type: config.type }, 'storage connection edit verified');
      } catch (err) {
        log.warn({ err, storage_type: config.type }, 'storage connection edit test failed');
        return message(form, connectionErrorMessage(err), { status: 400 });
      }
    }

    let payload = toStoredPayload(config, devUser);
    if (keepExistingCredentials && payload.type !== 'hdfs') {
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
          return message(form, 'Connection not found', { status: 404 });
        }
        const existing = decryptPayload(rows[0].encryptedPayload, storageEncryptionKey());
        payload = {
          ...payload,
          credentials: existing.type === 'hdfs' ? undefined : existing.credentials
        };
      } catch {
        return message(form, 'Failed to read existing credentials', { status: 500 });
      }
    }

    const key = storageEncryptionKey();
    const encryptedPayload = encrypt(JSON.stringify(payload), key);

    await db
      .update(userStorageConnections)
      .set({
        encryptedPayload,
        hash: payloadFingerprint(payload, key),
        name: form.data.name ?? undefined
      })
      .where(
        and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
      );

    log.info({ connection_id: connectionId }, 'storage connection updated');

    return message(form, 'ok');
  }
};
