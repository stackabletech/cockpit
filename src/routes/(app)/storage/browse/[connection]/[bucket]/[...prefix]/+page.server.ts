import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getActiveStorageConnectionId } from '$lib/server/storage/active-connection.js';

export const load: PageServerLoad = async ({ params, locals, cookies }) => {
  const activeId = getActiveStorageConnectionId(locals, cookies);
  if (!activeId) {
    throw redirect(303, '/storage');
  }

  const prefix = params.prefix ? params.prefix + '/' : '';
  const bucket = params.bucket;
  const connection = params.connection;
  return { connection, bucket, prefix, activeConnectionId: activeId };
};
