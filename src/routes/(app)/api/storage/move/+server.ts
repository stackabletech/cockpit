import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import {
  createStorageProvider,
  createStorageProviderForBucket
} from '$lib/server/storage/request-context.js';
import { performCopyOrMove } from '$lib/server/storage/copy-move.js';
import { MoveObjectsBodySchema } from '$lib/storage/schemas.js';

export const POST: RequestHandler = async (event) => {
  const { provider: destinationProvider, bucket } = createStorageProvider(event);
  const streamProgress = event.url.searchParams.get('progress') === 'true';
  const { locals, request } = event;

  const body = MoveObjectsBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) throw error(400, 'Invalid request body');
  const sourceBucket = body.data.sourceBucket ?? bucket;

  locals.logger.debug(
    {
      bucket,
      source_bucket: sourceBucket,
      source_key_count: body.data.sourceKeys.length,
      destination_prefix: body.data.destinationPrefix,
      destination_key: body.data.destinationKey,
      stream_progress: streamProgress
    },
    'move request received'
  );

  return performCopyOrMove({
    provider:
      sourceBucket === bucket
        ? destinationProvider
        : createStorageProviderForBucket(event, sourceBucket),
    destinationProvider: sourceBucket === bucket ? undefined : destinationProvider,
    sourceKeys: body.data.sourceKeys,
    destinationPrefix: body.data.destinationPrefix ?? '',
    destinationKey: body.data.destinationKey,
    streamProgress,
    logger: locals.logger,
    bucket,
    jobId: body.data.jobId,
    deleteOriginals: true
  });
};
