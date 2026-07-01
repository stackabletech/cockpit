import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { StorageConnectionSchema } from '$lib/storage/schemas.js';
import { listBuckets } from '$lib/server/storage/service.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';

export const load: PageServerLoad = async ({ locals }) => {
  const editForm = await superValidate(zod(StorageConnectionSchema));
  locals.logger.debug('loading storage connection edit page');
  return { editForm };
};

export const actions: Actions = {
  update: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(StorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection edit form validation failed');
      return fail(400, { form });
    }

    const { type, endpoint, pathStyle, region, accessKeyId, secretAccessKey } = form.data;

    if (type !== 's3') {
      return message(form, 'HDFS connections are not yet supported', { status: 400 });
    }

    const config: S3ConnectionConfig = {
      type: 's3',
      endpoint: endpoint || undefined,
      pathStyle,
      region,
      accessKeyId: accessKeyId || undefined,
      secretAccessKey: secretAccessKey || undefined
    };

    try {
      await listBuckets(config);
      log.info({ storage_type: type }, 'storage connection edit verified');
    } catch (err) {
      log.warn({ err }, 'storage connection edit test failed');
      return message(form, 'Could not connect — check the endpoint and credentials.', {
        status: 400
      });
    }

    return message(form, 'ok');
  }
};
