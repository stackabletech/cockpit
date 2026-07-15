import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';

export const POST: RequestHandler = async ({ locals, request, url }) => {
  const bucket = requireBucket(url);

  const body = (await request.json()) as { key: string; newKey: string };
  if (!body.key) {
    throw error(400, 'Missing required body field: key');
  }
  if (!body.newKey) {
    throw error(400, 'Missing required body field: newKey');
  }

  locals.logger.debug(
    { bucket, source_key: body.key, dest_key: body.newKey },
    'rename request received'
  );

  const provider = getProvider(locals.storageConfig!, bucket);

  // Conflict check: reject if destination already exists
  const exists = await provider.exists(body.newKey);
  if (exists) {
    throw error(409, `Destination "${body.newKey}" already exists`);
  }

  // If renaming a directory (key ends with /), we need to rename all children
  if (body.key.endsWith('/')) {
    const children = await provider.listAllKeys(body.key);
    // Rename the directory marker itself
    try {
      await provider.copyObject(body.key, body.newKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw error(502, `Rename failed for directory marker: ${message}`);
    }
    // Rename each child
    for (const child of children) {
      const destChild = body.newKey + child.slice(body.key.length);
      try {
        await provider.copyObject(child, destChild);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        throw error(502, `Rename failed for child "${child}": ${message}`);
      }
    }
    // Delete old paths
    const allOld = [body.key, ...children];
    const deleteResult = await provider.deleteObjects(allOld);
    if (deleteResult.failed.length > 0) {
      locals.logger.warn(
        { bucket, failed_count: deleteResult.failed.length },
        'rename delete had failures'
      );
    }
  } else {
    // Single file rename: copy + delete
    try {
      await provider.copyObject(body.key, body.newKey);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw error(502, `Rename failed: ${message}`);
    }
    try {
      await provider.deleteObjects([body.key]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      throw error(502, `Rename delete failed: ${message}`);
    }
  }

  locals.logger.info({ bucket, source_key: body.key, dest_key: body.newKey }, 'rename completed');

  return json({ success: true });
};
