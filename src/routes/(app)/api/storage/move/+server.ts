import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import {
  createStorageProvider,
  createStorageProviderForBucket
} from '$lib/server/storage/request-context.js';
import { performCopyOrMove } from '$lib/server/storage/copy-move.js';
import { MoveObjectsBodySchema } from '$lib/storage/schemas.js';
import {
  storageMoveEnabled,
  storagePasteEnabled,
  storageRenameEnabled
} from '$lib/server/feature-flags.js';

/** The prefix an object or folder key lives in (`a/b/` → `a/`, `a/x.txt` → `a/`). */
function parentPrefix(key: string): string {
  const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
  return trimmed.slice(0, trimmed.lastIndexOf('/') + 1);
}

export const POST: RequestHandler = async (event) => {
  const { provider: destinationProvider, bucket } = createStorageProvider(event);
  const streamProgress = event.url.searchParams.get('progress') === 'true';
  const { locals, request } = event;

  const body = MoveObjectsBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) throw error(400, 'Invalid request body');
  const sourceBucket = body.data.sourceBucket ?? bucket;

  // A rename is a move to a new name in the same bucket and folder. Paste uses
  // the same request to give a pasted item its "keep both" name, so paste
  // allows it too. Every other move comes from drag-and-drop or cut-and-paste.
  const destinationKey = body.data.destinationKey;
  const isRename =
    destinationKey !== undefined &&
    sourceBucket === bucket &&
    parentPrefix(destinationKey) === parentPrefix(body.data.sourceKeys[0]);
  const operation = isRename ? 'rename' : 'move';
  const allowed = storagePasteEnabled || (isRename ? storageRenameEnabled : storageMoveEnabled);
  if (!allowed) {
    locals.logger.warn(
      { bucket, source_bucket: sourceBucket, operation, user_id: locals.user?.id },
      'storage operation rejected: feature disabled'
    );
    throw error(404, `Storage ${operation} is disabled`);
  }

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
    userId: event.locals.user?.id ?? 'anonymous',
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
