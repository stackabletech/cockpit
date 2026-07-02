import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import { requireBucket } from '../params.js';

/**
 * Expand source keys so that directory prefixes are replaced by their
 * full recursive listing (including the directory marker).
 */
async function expandKeys(provider: StorageProvider, keys: string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const key of keys) {
    if (key.endsWith('/')) {
      const children = await provider.listAllKeys(key);
      expanded.push(key, ...children);
    } else {
      expanded.push(key);
    }
  }
  return expanded;
}

export const POST: RequestHandler = async ({ locals, request, url }) => {
  const bucket = requireBucket(url);

  const body = (await request.json()) as {
    sourceKeys: string[];
    destinationPrefix: string;
  };
  if (!body.sourceKeys?.length) {
    throw error(400, 'Missing required body field: sourceKeys');
  }
  if (body.destinationPrefix === undefined) {
    throw error(400, 'Missing required body field: destinationPrefix');
  }

  locals.logger.debug(
    {
      bucket,
      source_key_count: body.sourceKeys.length,
      destination_prefix: body.destinationPrefix
    },
    'move request received'
  );

  const provider = getProvider(locals.storageConfig!, bucket);

  // Expand directories to their full recursive listing
  const expanded = await expandKeys(provider, body.sourceKeys);

  const moved: Array<{ sourceKey: string; destKey: string }> = [];
  const failed: Array<{ sourceKey: string; error: string }> = [];

  for (const sourceKey of expanded) {
    const name = sourceKey.endsWith('/')
      ? sourceKey.split('/').slice(-2, -1)[0] + '/'
      : sourceKey.split('/').pop();
    const destKey = body.destinationPrefix + name;
    try {
      await provider.copyObject(sourceKey, destKey);
      moved.push({ sourceKey, destKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      failed.push({ sourceKey, error: message });
      locals.logger.warn(
        { bucket, source_key: sourceKey, dest_key: destKey, error: message },
        'move copy failed for key'
      );
    }
  }

  // Delete originals for successfully moved items
  const keysToDelete = [...new Set(moved.map((m) => m.sourceKey))];
  if (keysToDelete.length > 0) {
    const deleteResult = await provider.deleteObjects(keysToDelete);
    for (const f of deleteResult.failed) {
      failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
      locals.logger.warn({ bucket, key: f.key }, 'move delete failed for key');
    }
  }

  locals.logger.info({ bucket, moved: moved.length, failed: failed.length }, 'move completed');

  return json({ moved, failed });
};
