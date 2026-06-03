import { getConnectionProvider } from '$lib/server/storage/utils.js';
import type { RequestHandler } from './$types';

/**
 * GET /storage/api/buckets
 *
 * Returns the list of buckets accessible with the connection config supplied in
 * the `X-Storage-Connection` request header (base64-encoded JSON).
 * The config is parsed and validated by the `handleStorageConnection` middleware
 * in hooks.server.ts before this handler runs.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const buckets = await getConnectionProvider(locals.storageConfig!).listBuckets();
  locals.logger.debug({ bucket_count: buckets.length }, 'bucket list returned');
  return Response.json(buckets);
};
