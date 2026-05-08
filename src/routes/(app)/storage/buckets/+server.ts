import { json, error } from '@sveltejs/kit';
import { listBuckets, getConnection } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  const connection = getConnection(userId);

  if (!connection) {
    error(400, 'No storage connection configured');
  }

  try {
    const buckets = await listBuckets(userId);
    log.debug({ bucket_count: buckets.length }, 'listed buckets via API');
    return json(buckets);
  } catch (err) {
    log.warn({ err }, 'failed to list buckets');
    error(502, 'Failed to list buckets — check your storage connection');
  }
};
