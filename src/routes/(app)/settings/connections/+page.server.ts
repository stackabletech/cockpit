import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { ConnectionIdSchema } from '$lib/storage/schemas.js';
import { deleteConnection, listConnectionItems } from '$lib/server/storage/connections-db.js';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  getActiveStorageConnectionId,
  setActiveStorageConnectionId
} from '$lib/server/storage/active-connection.js';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading storage connections management page');

  const connections = await listConnectionItems(getUserId(locals));

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
