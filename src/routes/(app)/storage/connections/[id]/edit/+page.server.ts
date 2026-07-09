import { error, fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { eq, and } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { EditStorageConnectionSchema } from '$lib/storage/schemas.js';
import { z } from 'zod';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import { db } from '$lib/server/db.js';
import { userStorageConnections } from '$lib/server/schema.js';
import { decrypt, encrypt } from '$lib/server/storage/encryption.js';
import { storageEncryptionKey } from '$lib/server/storage/encryption-key.js';
import { logger } from '$lib/server/logging';

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
    throw redirect(303, '/storage/connections');
  }

  const row = rows[0];
  let payload: z.infer<typeof EditStorageConnectionSchema>;

  try {
    payload = JSON.parse(decrypt(row.encryptedPayload, storageEncryptionKey()));
  } catch {
    locals.logger.error({ connection_id: params.id }, 'failed to decrypt connection payload');
    throw error(500, 'Failed to load connection');
  }

  const editForm = await superValidate(
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
  return { editForm, connectionId: params.id };
};

export const actions: Actions = {
  update: async ({ request, locals, params }) => {
    const form = await superValidate(request, zod(EditStorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection edit form validation failed');
      return fail(400, { form });
    }

    const { type, host, port, tls, accessStyle, region, credentials } = form.data;
    const connectionId = params.id;
    const userId = locals.user!.id;

    if (type !== 's3') {
      return message(form, 'HDFS connections are not yet supported', { status: 400 });
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
        return message(form, 'Could not connect — check the endpoint and credentials.', {
          status: 400
        });
      }
    }

    // If no new credentials were provided, preserve the existing encrypted ones.
    let payload: object;
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
          return message(form, 'Connection not found', { status: 404 });
        }
        const existing = JSON.parse(decrypt(rows[0].encryptedPayload, storageEncryptionKey())) as {
          host: string;
          port?: number;
          tls?: object;
          accessStyle: string;
          region: object;
          credentials?: { accessKey: string; secretKey: string };
        };
        payload = { host, port, tls, accessStyle, region, credentials: existing.credentials };
      } catch {
        return message(form, 'Failed to read existing credentials', { status: 500 });
      }
    }

    const encryptedPayload = encrypt(JSON.stringify(payload), storageEncryptionKey());

    await db
      .update(userStorageConnections)
      .set({ encryptedPayload, name: form.data.name ?? undefined })
      .where(
        and(eq(userStorageConnections.id, connectionId), eq(userStorageConnections.userId, userId))
      );

    log.info({ connection_id: connectionId }, 'storage connection updated');

    return message(form, 'ok');
  }
};
