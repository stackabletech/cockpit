import { error, json } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/storage/rename?bucket=<bucket>
 *
 * Renames (moves) a storage object from `key` to `newKey`.
 * The request body must be JSON: `{ key: string, newKey: string }`.
 * Directory renames copy the marker and all children, then delete the originals.
 *
 * The connection config is parsed and validated by the `handleStorageConnection`
 * middleware in hooks.server.ts before this handler runs.
 */
export const POST: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const log = event.locals.logger;

  const body = (await event.request.json()) as { key?: string; newKey?: string };

  if (!body.key) throw error(400, 'Missing required body field: key');
  if (!body.newKey) throw error(400, 'Missing required body field: newKey');

  const key = body.key;
  const newKey = body.newKey;

  log.debug({ bucket, source_key: key, dest_key: newKey }, 'rename request received');

  const exists = await provider.exists(newKey);
  if (exists) throw error(409, `Destination "${newKey}" already exists`);

  if (key.endsWith('/')) {
    const children = await provider.listAllKeys(key);
    try {
      await provider.copyObject(key, newKey);
    } catch (err) {
      throw error(
        502,
        `Rename failed for directory marker: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
    for (const child of children) {
      const destChild = newKey + child.slice(key.length);
      try {
        await provider.copyObject(child, destChild);
      } catch (err) {
        throw error(
          502,
          `Rename failed for child "${child}": ${err instanceof Error ? err.message : 'Unknown error'}`
        );
      }
    }
    const deleteResult = await provider.deleteObjects([key, ...children]);
    if (deleteResult.failed.length > 0) {
      log.warn({ bucket, failed_count: deleteResult.failed.length }, 'rename delete had failures');
    }
  } else {
    try {
      await provider.copyObject(key, newKey);
    } catch (err) {
      throw error(502, `Rename failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    try {
      await provider.deleteObjects([key]);
    } catch (err) {
      throw error(
        502,
        `Rename delete failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  log.info({ bucket, source_key: key, dest_key: newKey }, 'rename completed');

  return json({ success: true });
};
