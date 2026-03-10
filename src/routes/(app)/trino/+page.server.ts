import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { setConnection, type AuthConfig } from '$lib/server/trino.js';
import { ConnectionSchema, type ConnectionMessage } from './schemas.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading Trino page');
  const connectionForm = await superValidate(zod(ConnectionSchema));
  return { connectionForm };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(ConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'connection form validation failed');
      return fail(400, { form });
    }

    const { connectionUrl, authType, authUsername, authPassword } = form.data;
    const auth: AuthConfig =
      authType === 'basic'
        ? { type: 'basic', username: authUsername, password: authPassword }
        : { type: 'none' };

    setConnection({ connectionUrl, auth });

    log.info({ trino_url: connectionUrl }, 'connection saved');

    return message(form, { type: 'success' } satisfies ConnectionMessage);
  }
};
