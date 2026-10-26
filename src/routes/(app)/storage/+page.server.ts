import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { StorageConnectionSchema, ConnectionIdSchema } from '$lib/storage/schemas.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  saveConnection,
  getConnectionForUser,
  deleteConnection,
  listConnectionItems
} from '$lib/server/storage/connections-db.js';
import {
  getActiveStorageConnectionId,
  setActiveStorageConnectionId
} from '$lib/server/storage/active-connection.js';
import type { ConnectionMetadata } from '$lib/server/storage/types.js';
import { getStorageIdentity } from '$lib/server/storage/connection-payload.js';
import { hdfsKerberosAvailable } from '$lib/server/feature-flags.js';
import {
  buildConnectionConfig,
  connectionErrorMessage
} from '$lib/server/storage/connection-form.js';

export const load: PageServerLoad = async ({ locals }) => {
  const log = locals.logger;
  const connectionForm = await superValidate(
    { tls: { verification: 'Full' } },
    zod(StorageConnectionSchema),
    { errors: false }
  );
  log.debug('loading storage page');

  const connections: ConnectionMetadata[] = (await listConnectionItems(getUserId(locals))).map(
    ({ id, name, type, endpoint }) => ({ id, name, type, endpoint })
  );

  return {
    connectionForm,
    connections,
    hdfsUser: locals.user?.username ?? null,
    hdfsKerberosAvailable
  };
};

export const actions: Actions = {
  connect: async ({ request, locals, cookies }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(StorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection form validation failed');
      return fail(400, { form });
    }

    const built = buildConnectionConfig(form.data, locals);
    if (!built.ok) {
      return message(form, built.message, { status: 400 });
    }
    const { config, devUser } = built;

    try {
      await getConnectionProvider(config).listContainers();
      log.info({ storage_type: config.type }, 'user storage connection verified');
    } catch (err) {
      log.warn({ err, storage_type: config.type }, 'storage connection test failed');
      return message(form, connectionErrorMessage(err), { status: 400 });
    }

    const id = await saveConnection(getUserId(locals), config, devUser);
    await setActiveStorageConnectionId({ request, locals, cookies }, id);

    throw redirect(303, '/storage');
  },

  disconnect: async ({ request, locals, cookies }) => {
    locals.logger.info('user storage connection cleared');
    await setActiveStorageConnectionId({ request, locals, cookies }, null);
    throw redirect(303, '/storage');
  },

  use: async ({ request, locals, cookies }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(ConnectionIdSchema));

    if (!form.valid) {
      return fail(400, { error: 'Invalid connection ID' });
    }

    const { connectionId } = form.data;

    const config = await getConnectionForUser(getStorageIdentity(locals), connectionId);
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

    await setActiveStorageConnectionId({ request, locals, cookies }, connectionId);

    throw redirect(303, '/storage');
  },

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

    throw redirect(303, '/storage');
  }
};
