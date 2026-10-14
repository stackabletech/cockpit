import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { createStorageProviderForBucket } from '$lib/server/storage/request-context.js';
import { storageTransferConcurrency } from '$lib/server/feature-flags.js';
import { requireTransferAllowed, requireValidTransfer } from '$lib/server/storage/transfer/http.js';
import {
  resolveItems,
  toPlanItem,
  type TransferRequest
} from '$lib/server/storage/transfer/resolve.js';
import { TransferPlanBodySchema } from '$lib/storage/schemas.js';

/**
 * POST /api/storage/transfer/plan
 *
 * Read-only preview of a copy or move for the conflict dialog: where each
 * selected item would land, whether that conflicts, and why an item would be
 * refused. Uses the same rules as the transfer itself.
 */
export const POST: RequestHandler = async (event) => {
  const { locals } = event;
  const body = TransferPlanBodySchema.safeParse(await event.request.json().catch(() => null));
  if (!body.success) throw error(400, 'Invalid request body');
  const { op, source, dest } = body.data;
  requireTransferAllowed(op, locals.logger, locals.user?.id);

  const request: TransferRequest = {
    op,
    sourceBucket: source.bucket,
    destBucket: dest.bucket,
    destPrefix: dest.prefix,
    items: source.keys.map((sourceKey) => ({ sourceKey }))
  };
  requireValidTransfer(request);

  const items = await resolveItems(request, createStorageProviderForBucket(event, dest.bucket), {
    mode: 'plan',
    concurrency: storageTransferConcurrency,
    signal: event.request.signal
  });

  locals.logger.debug(
    {
      op,
      source_bucket: source.bucket,
      dest_bucket: dest.bucket,
      dest_prefix: dest.prefix,
      item_count: items.length,
      conflict_count: items.filter((item) => item.conflict !== 'none').length,
      refused_count: items.filter((item) => item.refused).length
    },
    'transfer planned'
  );

  return json({ items: items.map(toPlanItem) });
};
