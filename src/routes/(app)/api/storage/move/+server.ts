import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { performCopyOrMove } from '$lib/server/storage/copy-move.js';

export const POST: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const streamProgress = event.url.searchParams.get('progress') === 'true';
  const { locals, request } = event;

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
    'move request received'
  );

  return performCopyOrMove({
    provider,
    sourceKeys: body.sourceKeys,
    destinationPrefix: body.destinationPrefix,
    streamProgress,
    logger: locals.logger,
    bucket,
    jobId: body.jobId,
    deleteOriginals: true
  });
};
