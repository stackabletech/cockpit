import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import type { Infer, InferIn } from 'sveltekit-superforms';
import { StorageConnectionSchema, type StorageConnectionMessage } from '$lib/storage/schemas.js';
import { listBuckets } from '$lib/server/storage/service.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import * as m from '$lib/paraglide/messages.js';

type ConnectionData = Infer<typeof StorageConnectionSchema>;
type ConnectionInput = InferIn<typeof StorageConnectionSchema>;

export const load: PageServerLoad = async ({ locals }) => {
  const connectionForm = await superValidate<
    ConnectionData,
    StorageConnectionMessage,
    ConnectionInput
  >({ tls: { verification: 'Full' } }, zod(StorageConnectionSchema), { errors: false });
  locals.logger.debug('loading storage page');
  return { connectionForm };
};

export const actions: Actions = {
  connect: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate<ConnectionData, StorageConnectionMessage, ConnectionInput>(
      request,
      zod(StorageConnectionSchema)
    );

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection form validation failed');
      return fail(400, { form });
    }

    const { type, host, port, tls, accessStyle, region, credentials } = form.data;

    if (type !== 's3') {
      return message(
        form,
        { type: 'error', message: m.storage_connect_error_hdfs() },
        { status: 400 }
      );
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
      await listBuckets(config);
      log.info({ storage_type: type }, 'user storage connection verified');
    } catch (err) {
      log.warn({ err }, 'storage connection test failed');
      return message(form, { type: 'error', message: m.storage_connect_error() }, { status: 400 });
    }

    throw redirect(303, '/storage');
  },

  disconnect: async ({ locals }) => {
    locals.logger.info('user storage connection cleared');
    throw redirect(303, '/storage?disconnected=1');
  }
};
