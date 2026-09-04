import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/list?bucket=<bucket>&prefix=<prefix>&pageSize=<n>&continuationToken=<token>
 *
 * Lists objects in a bucket with cursor-based pagination. Returns the S3
 * list objects response directly.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const prefix = event.url.searchParams.get('prefix')?.trim() ?? undefined;
  const rawPageSize = event.url.searchParams.get('pageSize');
  const pageSize = rawPageSize ? parseInt(rawPageSize, 10) : 25;
  const continuationToken = event.url.searchParams.get('continuationToken') || undefined;
  const log = event.locals.logger;

  log.debug(
    {
      bucket,
      prefix: prefix ?? '',
      continuation_token: continuationToken,
      page_size: pageSize
    },
    'listing objects'
  );

  const page = await provider.listObjects(prefix ?? '', pageSize, continuationToken);

  return Response.json(page);
};
