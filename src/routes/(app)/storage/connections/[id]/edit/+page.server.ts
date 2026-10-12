import { fail } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import type { Infer, InferIn } from 'sveltekit-superforms';
import {
  EditStorageConnectionSchema,
  type StorageConnectionMessage
} from '$lib/storage/schemas.js';
import { listBuckets } from '$lib/server/storage/service.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';
import * as m from '$lib/paraglide/messages.js';

type EditData = Infer<typeof EditStorageConnectionSchema>;
type EditInput = InferIn<typeof EditStorageConnectionSchema>;

export const load: PageServerLoad = async ({ locals }) => {
  const editForm = await superValidate<EditData, StorageConnectionMessage, EditInput>(
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
    const form = await superValidate<EditData, StorageConnectionMessage, EditInput>(
      request,
      zod(EditStorageConnectionSchema)
    );

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection edit form validation failed');
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

    // If no credentials were submitted the user chose to keep the existing ones,
    // so skip the live connection test (it was already verified when first saved).
    if (resolvedCredentials) {
      try {
        await listBuckets(config);
        log.info({ storage_type: type }, 'storage connection edit verified');
      } catch (err) {
        log.warn({ err }, 'storage connection edit test failed');
        return message(
          form,
          { type: 'error', message: m.storage_connect_error() },
          { status: 400 }
        );
      }
    }

    return message(form, { type: 'success' });
  }
};
