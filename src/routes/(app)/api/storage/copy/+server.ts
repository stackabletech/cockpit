import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';
import { performCopyOrMove } from '$lib/server/storage/copy-move.js';

export const POST: RequestHandler = async ({ locals, request, url }) => {
  const bucket = requireBucket(url);
  const streamProgress = url.searchParams.get('progress') === 'true';

  const body = (await request.json()) as {
    sourceKeys: string[];
    destinationPrefix: string;
    jobId?: string;
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
      destination_prefix: body.destinationPrefix,
      stream_progress: streamProgress
    },
    'copy request received'
  );

  const provider = getProvider(locals.storageConfig!, bucket);

  return performCopyOrMove({
    provider,
    sourceKeys: body.sourceKeys,
    destinationPrefix: body.destinationPrefix,
    streamProgress,
    logger: locals.logger,
    bucket,
    jobId: body.jobId,
    deleteOriginals: false
  });
};
