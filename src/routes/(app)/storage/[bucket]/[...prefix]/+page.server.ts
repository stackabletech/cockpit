import type { PageServerLoad } from './$types';
import { listObjects } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';

export const load: PageServerLoad = async ({ locals, params }) => {
  const userId = getUserId(locals);
  const prefix = params.prefix ? params.prefix + '/' : '';
  const bucket = params.bucket;

  locals.logger.debug({ bucket, prefix }, 'loading storage bucket objects');

  const objects = await listObjects(userId, bucket, prefix);
  return { objects, prefix, bucket };
};
