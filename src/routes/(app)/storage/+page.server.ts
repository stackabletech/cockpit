import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { StorageConnectionSchema, ConnectionIdSchema } from '$lib/storage/schemas.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import {
  saveConnection,
  getConnectionForUser,
  deleteConnection
} from '$lib/server/storage/connections-db.js';
import { auth } from '$lib/server/auth.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';

export const load: PageServerLoad = async ({ locals }) => {
  const connectionForm = await superValidate(zod(StorageConnectionSchema));
  locals.logger.debug('loading storage page');
  return { connectionForm };
};

export const actions: Actions = {
  connect: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(StorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection form validation failed');
      return fail(400, { form });
    }

    const { type, endpoint, pathStyle, region, accessKeyId, secretAccessKey } = form.data;

    if (type !== 's3') {
      return message(form, 'HDFS connections are not yet supported', { status: 400 });
    }

    const config: S3ConnectionConfig = {
      type: 's3',
      endpoint: endpoint || undefined,
      pathStyle,
      region,
      accessKeyId: accessKeyId || undefined,
      secretAccessKey: secretAccessKey || undefined
    };

    try {
      await getConnectionProvider(config).listContainers();
      log.info({ storage_type: type }, 'user storage connection verified');
    } catch (err) {
      log.warn({ err }, 'storage connection test failed');
      return message(form, 'Could not connect — check the endpoint and credentials.', {
        status: 400
      });
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
    throw redirect(303, '/storage?disconnected=1');
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
    log.info({ connectionId }, 'storage connection deleted');

    throw redirect(303, '/storage');
  }
};
