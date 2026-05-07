import type { PageServerLoad } from './$types';
import { listObjects } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';

export const load: PageServerLoad = async ({ locals, params, url }) => {
  const userId = getUserId(locals);
  const prefix = params.prefix ? params.prefix + '/' : '';
  const bucket = params.bucket;
  const continuationToken = url.searchParams.get('continuationToken');
  const pageSizeParam = url.searchParams.get('pageSize');
  const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : undefined;

  locals.logger.debug({ bucket, prefix, continuation_token: continuationToken, page_size: pageSize }, 'loading storage bucket objects');

  const objects = await listObjects(userId, bucket, prefix, pageSize ?? 25, continuationToken ?? undefined);
  return { objects, prefix, bucket };
};
