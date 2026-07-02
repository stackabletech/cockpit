import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';

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
    'copy request received'
  );

  const provider = getProvider(locals.storageConfig!, bucket);

  const results: Array<{ sourceKey: string; destKey: string }> = [];
  const failed: Array<{ sourceKey: string; error: string }> = [];

  for (const sourceKey of body.sourceKeys) {
    const name = sourceKey.endsWith('/')
      ? sourceKey.split('/').slice(-2, -1)[0] + '/'
      : sourceKey.split('/').pop();
    const destKey = body.destinationPrefix + name;
    try {
      await provider.copyObject(sourceKey, destKey);
      results.push({ sourceKey, destKey });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      failed.push({ sourceKey, error: message });
      locals.logger.warn(
        { bucket, source_key: sourceKey, dest_key: destKey, error: message },
        'copy failed for key'
      );
    }
  }

  locals.logger.info({ bucket, copied: results.length, failed: failed.length }, 'copy completed');

  return json({ results, failed });
};
