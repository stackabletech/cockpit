import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { EditStorageConnectionSchema } from '$lib/storage/schemas.js';
import { listBuckets } from '$lib/server/storage/service.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';

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
      return message(form, 'HDFS connections are not yet supported', { status: 400 });
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
        await listBuckets(config);
        log.info({ storage_type: type }, 'storage connection edit verified');
      } catch (err) {
        log.warn({ err }, 'storage connection edit test failed');
        return message(form, 'Could not connect — check the endpoint and credentials.', {
          status: 400
        });
      }
    }

    return message(form, 'ok');
  }
};
