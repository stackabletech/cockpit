import { fail, redirect } from '@sveltejs/kit';
import { superValidate, message } from 'sveltekit-superforms';
import { zod4 as zod } from 'sveltekit-superforms/adapters';
import type { Actions, PageServerLoad } from './$types';
import { StorageConnectionSchema } from './validation.js';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  setUserConnection,
  clearUserConnection,
  listBucketsForUser,
  getUserConnection
} from '$lib/server/storage/user-connections.js';
import type { S3ConnectionConfig } from '$lib/server/storage/types.js';

export const load: PageServerLoad = async ({ locals }) => {
  const connectionForm = await superValidate(zod(StorageConnectionSchema));
  const userId = getUserId(locals);
  const connected = getUserConnection(userId) !== null;
  locals.logger.debug({ connected }, 'loading storage page');
  return { connectionForm, connected };
};

export const actions: Actions = {
  connect: async ({ request, locals }) => {
    const log = locals.logger;
    const form = await superValidate(request, zod(StorageConnectionSchema));

    if (!form.valid) {
      log.debug({ errors: form.errors }, 'storage connection form validation failed');
      return fail(400, { form });
    }

    const userId = getUserId(locals);
    const { type, endpoint, region, accessKeyId, secretAccessKey } = form.data;

    if (type !== 's3') {
      return message(form, 'HDFS connections are not yet supported', { status: 400 });
    }

    const config: S3ConnectionConfig = {
      type: 's3',
      endpoint: endpoint || undefined,
      region,
      accessKeyId: accessKeyId || undefined,
      secretAccessKey: secretAccessKey || undefined
    };

    try {
      setUserConnection(userId, config);
      await listBucketsForUser(userId);
      log.info({ storage_type: type }, 'user storage connection verified and saved');
    } catch (err) {
      clearUserConnection(userId);
      log.warn({ err }, 'storage connection test failed');
      return message(form, 'Could not connect — check the endpoint and credentials.', {
        status: 400
      });
    }

    throw redirect(303, '/storage');
  },

  disconnect: async ({ locals }) => {
    const userId = getUserId(locals);
    clearUserConnection(userId);
    locals.logger.info({ user_id: userId }, 'user storage connection cleared');
    throw redirect(303, '/storage');
  }
};
