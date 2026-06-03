import { getConnectionProvider } from '$lib/server/storage/utils.js';
import { requireConnection } from '$lib/server/storage/connection.js';
import type { RequestHandler } from './$types';

/**
 * GET /storage/api/buckets
 *
 * Returns the list of buckets accessible with the connection config supplied in
 * the `X-Storage-Connection` request header (base64-encoded JSON).
 */
export const GET: RequestHandler = async ({ request, locals }) => {
  const config = requireConnection(request);
  const buckets = await getConnectionProvider(config).listBuckets();
  locals.logger.debug({ bucket_count: buckets.length }, 'bucket list returned');
  return Response.json(buckets);
};
