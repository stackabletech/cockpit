import { getProvider } from '$lib/server/storage/utils.js';
import type { RequestHandler } from '@sveltejs/kit';
import { requireBucketKey } from '../params.js';

/**
 * POST /api/storage/create?bucket=<bucket>&key=<object-key>
 *
 * Creates an empty object (zero bytes) at the given key.
 * If the key ends with '/', it creates a directory marker.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
  const log = locals.logger;
  const { bucket, key } = requireBucketKey(url);

  log.debug({ bucket, key }, 'creating object');

  const contentType = key.endsWith('/') ? 'application/x-directory' : 'text/plain';

  await getProvider(locals.storageConfig!, bucket).putObject(key, Buffer.alloc(0), contentType, 0);

  log.info({ bucket, key, content_type: contentType }, 'object created');

  return new Response(null, { status: 201 });
};
