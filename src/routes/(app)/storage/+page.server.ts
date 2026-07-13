import { fail, redirect, isHttpError } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { StorageConnectionSchema } from '$lib/storage/schemas.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import * as m from '$lib/paraglide/messages.js';

export const load: PageServerLoad = async ({ locals }) => {
  const connectionForm = await superValidate(
    { tls: { verification: 'Full' } },
    zod(StorageConnectionSchema),
    { errors: false }
  );
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

    const { type, host, port, tls, accessStyle, region, credentials } = form.data;

    if (type !== 's3') {
      return message(form, m.storage_connect_error_hdfs(), { status: 400 });
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

    try {
      await getConnectionProvider(config).listContainers();
      log.info({ storage_type: type }, 'user storage connection verified');
    } catch (err) {
      log.warn({ err }, 'storage connection test failed');

      let msg: string;
      if (isHttpError(err)) {
        if (err.status === 403) {
          msg = m.storage_connect_error_access_denied();
        } else if (err.status === 404) {
          msg = m.storage_connect_error_not_found();
        } else if (err.status === 502) {
          msg = m.storage_connect_error_server_error();
        } else {
          msg = m.storage_connect_error();
        }
      } else if (err instanceof Error) {
        const e = (err.message ?? '').toLowerCase();
        if (/econnrefused|enotfound|eai_again|etimedout|network/.test(e)) {
          msg = m.storage_connect_error_network();
        } else {
          msg = m.storage_connect_error();
        }
      } else {
        msg = m.storage_connect_error();
      }

      return message(form, msg, { status: 400 });
    }

    throw redirect(303, '/storage');
  },

  disconnect: async ({ locals }) => {
    locals.logger.info('user storage connection cleared');
    throw redirect(303, '/storage?disconnected=1');
  }
};
