import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { superValidate } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { ConnectionIdSchema } from '$lib/storage/schemas.js';
import { deleteConnection } from '$lib/server/storage/connections-db.js';
import { auth } from '$lib/server/auth.js';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading storage connections management page');
  return {};
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
