import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { getUserId } from '$lib/server/auth-utils.js';
import { getQuerySnapshot, cancelQuery } from '$lib/server/trino/queries.js';
import { trinoConfigured } from '$lib/server/trino/client.js';
import { createUserTrinoClient, getUserTrinoClient } from '$lib/server/trino/user-clients.js';
import { ConnectionSchema, type ConnectionMessage } from './validation.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading Trino page');
  const connectionForm = await superValidate(zod(ConnectionSchema));
  const userId = getUserId(locals);
  const activeQuery = getQuerySnapshot(userId) ?? null;
  const userClientExists = getUserTrinoClient(userId) !== null;
  return { connectionForm, activeQuery, trinoConfigured, userClientExists };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const log = locals.logger;

    if (trinoConfigured) {
      return fail(400, { error: 'Connection is managed via environment variables' });
    }

    const form = await superValidate(request, zod(ConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'connection form validation failed');
      return fail(400, { form });
    }

    const userId = getUserId(locals);

    // Cancel any running query before replacing the connection.
    await cancelQuery(userId);

    const { connectionUrl, authType, authUsername, authPassword } = form.data;

    createUserTrinoClient(userId, {
      url: connectionUrl,
      authType,
      username: authUsername,
      password: authPassword
    });

    log.info({ trino_url: connectionUrl }, 'user connection saved');
    return message(form, { type: 'success' } satisfies ConnectionMessage);
  }
};
