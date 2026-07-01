import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/objects?bucket=<bucket>&prefix=<prefix>&pageSize=<n>&continuationToken=<token>
 *
 * Returns a page of objects in the given bucket/prefix using the connection
 * config supplied in the `X-Storage-Connection` request header.
 * The config is parsed and validated by the `handleStorageConnection` middleware
 * in hooks.server.ts before this handler runs.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
  const bucket = url.searchParams.get('bucket')?.trim();
  if (!bucket) throw error(400, 'Missing required query parameter: bucket');

  const prefix = url.searchParams.get('prefix') ?? '';
  const continuationToken = url.searchParams.get('continuationToken');
  const pageSizeParam = url.searchParams.get('pageSize');
  const pageSize = pageSizeParam ? parseInt(pageSizeParam, 10) : 25;

  locals.logger.debug(
    { bucket, prefix, continuation_token: continuationToken, page_size: pageSize },
    'listing objects'
  );

  const page = await getProvider(locals.storageConfig!, bucket).listObjects(
    prefix,
    pageSize,
    continuationToken ?? undefined
  );
  return Response.json(page);
};
