import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { RequestHandler } from './$types';
import { StorageObjectNameSchema } from '$lib/storage/schemas.js';

/**
 * POST /api/storage/create?bucket=<bucket>&key=<object-key>
 *
 * Creates an empty object (or directory marker when the key ends with `/`).
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const parsedKey = StorageObjectNameSchema.safeParse(event.url.searchParams.get('key'));
  if (!parsedKey.success) throw error(400, 'Invalid query parameter: key');
  const key = parsedKey.data;
  const log = event.locals.logger;

  const contentType = key.endsWith('/') ? 'application/x-directory' : 'text/plain';

  log.debug({ bucket, key }, 'creating object');

  await provider.putObject(key, Buffer.alloc(0), contentType, 0);

  log.info({ bucket, key, content_type: contentType }, 'object created');

  return new Response(null, { status: 201 });
};
