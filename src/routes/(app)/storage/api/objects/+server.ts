import { error } from '@sveltejs/kit';
import { listObjects } from '$lib/server/storage/service.js';
import type { RequestHandler } from './$types';

/**
 * GET /storage/api/objects?bucket=<bucket>&prefix=<prefix>&pageSize=<n>&continuationToken=<token>
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

  const page = await listObjects(
    locals.storageConfig!,
    bucket,
    prefix,
    pageSize,
    continuationToken
  );
  return Response.json(page);
};
