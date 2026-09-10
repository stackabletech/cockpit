import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/storage/create?bucket=<bucket>&key=<object-key>
 *
 * Creates an empty object (or directory marker when the key ends with `/`).
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const key = event.url.searchParams.get('key')?.trim();
  if (!key) throw error(400, 'Missing required query parameter: key');
  const log = event.locals.logger;

  const contentType = key.endsWith('/') ? 'application/x-directory' : 'text/plain';

  log.debug({ bucket, key }, 'creating object');

  await provider.putObject(key, Buffer.alloc(0), contentType, 0);

  log.info({ bucket, key, content_type: contentType }, 'object created');

  return new Response(null, { status: 201 });
};
