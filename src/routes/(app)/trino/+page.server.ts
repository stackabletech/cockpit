import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import { getUserId } from '$lib/server/auth-utils.js';
import { getAllQuerySummaries, resetTabQueries } from '$lib/server/trino/queries.js';
import {
  trinoConfigured,
  trinoMetadataQuery,
  CONN_TEST_TIMEOUT_MS
} from '$lib/server/trino/client.js';
import { completionEnabled } from '$lib/server/feature-flags.js';
import {
  buildUserTrinoClient,
  createUserTrinoClient,
  getUserTrinoClient
} from '$lib/server/trino/user-clients.js';
import { ConnectionSchema, type ConnectionMessage } from './validation.js';
import type { Actions, PageServerLoad } from './$types';
import * as m from '$lib/paraglide/messages.js';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading Trino page');
  const connectionForm = await superValidate(zod(ConnectionSchema));
  const userId = getUserId(locals);
  const activeQueries = getAllQuerySummaries(userId);
  const userClientExists = getUserTrinoClient(userId) !== null;
  return { connectionForm, activeQueries, trinoConfigured, userClientExists, completionEnabled };
};

export const actions: Actions = {
  save: async ({ request, locals }) => {
    const log = locals.logger;

    const form = await superValidate(request, zod(ConnectionSchema));

    if (trinoConfigured) {
      log.debug('connection save rejected, Trino is configured via environment variables');
      return message(
        form,
        { type: 'error', message: m.trino_connection_env_managed() } satisfies ConnectionMessage,
        { status: 400 }
      );
    }

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'connection form validation failed');
      return fail(400, { form });
    }

    const userId = getUserId(locals);
    const user = locals.user?.username ?? 'anonymous';
    const { connectionUrl, authType, authUsername, authPassword } = form.data;
    const config = {
      url: connectionUrl,
      authType,
      username: authUsername,
      password: authPassword
    };

    // Verify connectivity before storing the client or cancelling running queries.
    try {
      const testClient = buildUserTrinoClient(config);
      await trinoMetadataQuery(
        testClient,
        'SELECT 1',
        { user },
        AbortSignal.timeout(CONN_TEST_TIMEOUT_MS)
      );
    } catch (err) {
      const name = (err as { name?: string })?.name;
      const reason =
        name === 'TimeoutError' || name === 'AbortError'
          ? m.trino_connection_test_timeout()
          : m.trino_connection_test_failed();
      log.info({ err, trino_url: connectionUrl }, 'connection test failed');
      return message(form, { type: 'error', message: reason } satisfies ConnectionMessage, {
        status: 400
      });
    }

    // Cancel running queries and drop results from the previous connection.
    for (const tabId of Object.keys(getAllQuerySummaries(userId))) {
      await resetTabQueries(userId, tabId);
    }

    createUserTrinoClient(userId, config);

    log.info({ trino_url: connectionUrl }, 'user connection saved');
    return message(form, { type: 'success' } satisfies ConnectionMessage);
  }
};
