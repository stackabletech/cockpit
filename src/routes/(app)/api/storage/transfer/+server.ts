import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { createStorageProviderForBucket } from '$lib/server/storage/request-context.js';
import { storageTransferConcurrency } from '$lib/server/storage/config.js';
import {
  requireTransferAllowed,
  requireValidTransfer,
  streamTransfer
} from '$lib/server/storage/transfer/http.js';
import type { TransferRequest } from '$lib/server/storage/transfer/resolve.js';
import { TransferBodySchema } from '$lib/storage/schemas.js';

/**
 * POST /api/storage/transfer
 *
 * Copy, move or rename the selected items within one storage connection and
 * stream NDJSON events (`item-start`, `progress`, `item-done`, `complete`).
 * HTTP errors are request-level only; every item reports its own status.
 */
export const POST: RequestHandler = async (event) => {
  const { locals } = event;
  const body = TransferBodySchema.safeParse(await event.request.json().catch(() => null));
  if (!body.success) throw error(400, 'Invalid request body');
  const { op, jobId, source, dest, items } = body.data;
  requireTransferAllowed(op, locals.logger, locals.user?.id);

  const destBucket = dest?.bucket ?? source.bucket;
  const request: TransferRequest = {
    op,
    sourceBucket: source.bucket,
    destBucket,
    destPrefix: dest?.prefix ?? '',
    items
  };
  requireValidTransfer(request);

  locals.logger.debug(
    {
      op,
      job_id: jobId,
      source_bucket: source.bucket,
      dest_bucket: destBucket,
      dest_prefix: dest?.prefix,
      item_count: items.length
    },
    'transfer request received'
  );

  const sourceProvider = createStorageProviderForBucket(event, source.bucket);
  return streamTransfer({
    request,
    jobId,
    userId: locals.user?.id ?? 'anonymous',
    source: sourceProvider,
    dest:
      destBucket === source.bucket
        ? sourceProvider
        : createStorageProviderForBucket(event, destBucket),
    concurrency: storageTransferConcurrency,
    logger: locals.logger
  });
};
