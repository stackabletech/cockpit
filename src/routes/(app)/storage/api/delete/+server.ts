import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { deleteObjects } from '$lib/server/storage/service.js';
import { requireConnection } from '$lib/server/storage/connection.js';
import { requireBucket } from '../params.js';

/**
 * DELETE /storage/api/delete?bucket=<bucket>&keys=<key1>&keys=<key2>&...
 *
 * Deletes one or more S3 objects from the given bucket.
 * Authentication is enforced by the app-level auth guard in hooks.server.ts.
 *
 * The connection config is read from the `X-Storage-Connection` request header
 * (base64-encoded JSON), set by the client from its localStorage entry.
 */
export const DELETE: RequestHandler = async ({ locals, url, request }) => {
  const bucket = requireBucket(url);
  const config = requireConnection(request);

  const keys = url.searchParams.getAll('keys');
  if (!keys.length) {
    throw error(400, 'Missing required query parameter: keys');
  }

  locals.logger.debug({ bucket, key_count: keys.length }, 'delete request received');

  const result = await deleteObjects(config, bucket, keys);

  locals.logger.info(
    { bucket, key_count: keys.length, failed_count: result.failed.length },
    'objects delete completed'
  );

  return Response.json(result);
};
