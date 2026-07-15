import { getConnectionProvider } from '$lib/server/storage/utils.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/buckets
 *
 * Returns the list of buckets accessible with the connection config supplied in
 * the `x-storage-connection-id` request header. The config is resolved and
 * decrypted by the `handleStorageConnection` middleware in hooks.server.ts
 * before this handler runs.
 *
 * Additional buckets stored with the connection (not returned by ListBuckets)
 * are merged into the response.
 */
export const GET: RequestHandler = async ({ locals }) => {
  const config = locals.storageConfig!;
  const listedBuckets = await getConnectionProvider(config).listContainers();
  const additional = config.additionalBuckets ?? [];
  const allBuckets = [...new Set([...listedBuckets, ...additional])];
  locals.logger.debug({ bucket_count: allBuckets.length }, 'bucket list returned');
  return Response.json(allBuckets);
};
