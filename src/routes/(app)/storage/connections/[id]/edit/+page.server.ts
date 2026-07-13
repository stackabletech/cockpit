import { fail, isHttpError } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { EditStorageConnectionSchema } from '$lib/storage/schemas.js';
import { getConnectionProvider } from '$lib/server/storage/utils.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import * as m from '$lib/paraglide/messages.js';

export const load: PageServerLoad = async ({ locals }) => {
  const editForm = await superValidate(
    { tls: { verification: 'Full' } },
    zod(EditStorageConnectionSchema),
    { errors: false }
  );
  locals.logger.debug('loading storage connection edit page');
  return { editForm };
};

export const actions: Actions = {
  update: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(EditStorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection edit form validation failed');
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

    // If no credentials were submitted the user chose to keep the existing ones,
    // so skip the live connection test (it was already verified when first saved).
    if (resolvedCredentials) {
      try {
        await getConnectionProvider(config).listContainers();
        log.info({ storage_type: type }, 'storage connection edit verified');
      } catch (err) {
        log.warn({ err }, 'storage connection edit test failed');

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
    }

    return message(form, 'ok');
  }
};
