import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { AuthConfig } from '$lib/server/trino-config.js';
import { setUserConnection } from '$lib/server/trino-clients.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { cancelQuery, getQuerySnapshot } from '$lib/server/trino-queries.js';
import { trinoEnvConfigured, buildEnvConnectionConfig } from '$lib/server/trino-env-config.js';
import { ConnectionSchema, type ConnectionMessage } from './validation.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading Trino page');
  const connectionForm = await superValidate(zod(ConnectionSchema));
  const userId = getUserId(locals);

  if (trinoEnvConfigured) {
    const config = buildEnvConnectionConfig(locals.user?.username ?? 'anonymous');
    setUserConnection(userId, config);
  }

  const activeQuery = getQuerySnapshot(userId) ?? null;
  return { connectionForm, activeQuery, trinoEnvConfigured };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(ConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'connection form validation failed');
      return fail(400, { form });
    }

    const userId = getUserId(locals);
    const username = locals.user?.username ?? 'anonymous';

    // Cancel any running query before replacing the connection.
    await cancelQuery(userId);

    if (trinoEnvConfigured) {
      const { defaultCatalog, defaultSchema } = form.data;
      const config = buildEnvConnectionConfig(username, defaultCatalog, defaultSchema);
      setUserConnection(userId, config);
      log.info('connection saved (env-configured)');
    } else {
      const { connectionUrl, authType, authUsername, authPassword, defaultCatalog, defaultSchema } =
        form.data;
      const auth: AuthConfig =
        authType === 'basic'
          ? { type: 'basic', username: authUsername, password: authPassword }
          : { type: 'none' };

      setUserConnection(userId, {
        connectionUrl,
        auth,
        username,
        defaultCatalog,
        defaultSchema
      });

      log.info({ trino_url: connectionUrl }, 'connection saved');
    }

    return message(form, { type: 'success' } satisfies ConnectionMessage);
  }
};
