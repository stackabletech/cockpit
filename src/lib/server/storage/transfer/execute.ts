import type pino from 'pino';
import type { StorageProvider } from '../provider.js';
import type {
  TransferEvent,
  TransferItemResult,
  TransferObjectFailure,
  TransferSummary
} from '$lib/storage/transfer-types.js';
import { runPool } from './pool.js';
import {
  isTooLong,
  resolveItems,
  transferErrorMessage,
  type ResolvedItem,
  type TransferRequest
} from './resolve.js';

/** Progress events of one item are sent at most this often. */
const PROGRESS_INTERVAL_MS = 250;

export interface TransferContext {
  /** Provider of the source bucket; originals of a move are deleted here. */
  source: StorageProvider;
  /** Provider of the destination bucket; copies run here. */
  dest: StorageProvider;
  /** Objects copied at once within one item. */
  concurrency: number;
  /** Cancels the transfer: running S3 calls are aborted and no further item starts. */
  signal: AbortSignal;
  logger: pino.Logger;
  emit: (event: TransferEvent) => void;
}

interface SourceObject {
  key: string;
  size: number;
}

function emptySummary(): TransferSummary {
  return { done: 0, partial: 0, failed: 0, refused: 0, cancelled: 0 };
}

function result(
  item: ResolvedItem,
  fields: Partial<TransferItemResult> & Pick<TransferItemResult, 'status'>
): TransferItemResult {
  return { sourceKey: item.sourceKey, copied: 0, failed: [], deletedOriginals: 0, ...fields };
}

/** Every object of an item, with sizes. An empty list means the source is gone. */
async function listSource(item: ResolvedItem, ctx: TransferContext): Promise<SourceObject[]> {
  if (item.kind === 'file') {
    const meta = await ctx.source.getMetadata(item.sourceKey);
    return [{ key: item.sourceKey, size: meta.size }];
  }
  const objects: SourceObject[] = [];
  await ctx.source.listAllKeysProgressively(
    item.sourceKey,
    (batch) => {
      for (const { key, size } of batch) objects.push({ key, size });
    },
    { signal: ctx.signal }
  );
  return objects;
}

async function runItem(
  item: ResolvedItem,
  request: TransferRequest,
  ctx: TransferContext
): Promise<TransferItemResult> {
  const { signal, logger } = ctx;
  const destRoot = item.destKey;
  const deleteOriginals = request.op !== 'copy';

  let objects: SourceObject[];
  try {
    objects = await listSource(item, ctx);
  } catch (err) {
    if (signal.aborted) return result(item, { status: 'cancelled' });
    return result(item, {
      status: 'failed',
      failed: [{ key: item.sourceKey, error: transferErrorMessage(err) }]
    });
  }
  if (objects.length === 0) {
    return result(item, {
      status: 'failed',
      failed: [{ key: item.sourceKey, error: 'Source not found' }]
    });
  }
  const destKeyFor = (object: SourceObject) =>
    item.kind === 'file' ? destRoot : destRoot + object.key.slice(item.sourceKey.length);
  // A child can exceed the key limit even when the folder name fits; refuse before copying anything.
  if (objects.some((object) => isTooLong(destKeyFor(object)))) {
    return result(item, { status: 'refused', reason: 'name_too_long' });
  }

  const totalBytes = objects.reduce((sum, object) => sum + object.size, 0);
  ctx.emit({
    type: 'item-start',
    sourceKey: item.sourceKey,
    destRoot,
    totalObjects: objects.length,
    totalBytes
  });

  const copied: SourceObject[] = [];
  const failed: TransferObjectFailure[] = [];
  let copiedBytes = 0;
  // Bytes of multipart copies still running, so large objects show progress.
  const partialBytes = new Map<string, number>();
  let lastProgress = 0;
  const reportProgress = () => {
    const now = Date.now();
    if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    let inFlight = 0;
    for (const bytes of partialBytes.values()) inFlight += bytes;
    ctx.emit({
      type: 'progress',
      sourceKey: item.sourceKey,
      copiedObjects: copied.length,
      copiedBytes: copiedBytes + inFlight
    });
  };

  await runPool(
    objects,
    ctx.concurrency,
    async (object) => {
      const destKey = destKeyFor(object);
      try {
        await ctx.dest.copyObject(object.key, destKey, {
          sourceBucket: request.sourceBucket,
          signal,
          onProgress: (loaded) => {
            partialBytes.set(object.key, loaded);
            reportProgress();
          }
        });
        copied.push(object);
        copiedBytes += object.size;
      } catch (err) {
        // An aborted call is an interrupted copy, not a failed one.
        if (signal.aborted) return;
        const error = transferErrorMessage(err);
        failed.push({ key: object.key, error });
        logger.warn(
          {
            source_bucket: request.sourceBucket,
            dest_bucket: request.destBucket,
            source_key: object.key,
            dest_key: destKey,
            error
          },
          'transfer object copy failed'
        );
      } finally {
        partialBytes.delete(object.key);
      }
      reportProgress();
    },
    signal
  );

  const counts = { destRoot, copied: copied.length, failed };
  const complete = copied.length === objects.length;
  // A move keeps its originals once cancelled, even when every copy finished.
  if (signal.aborted && (!complete || deleteOriginals)) {
    return result(item, { status: 'cancelled', ...counts });
  }
  if (!complete) {
    return result(item, { status: copied.length === 0 ? 'failed' : 'partial', ...counts });
  }
  if (!deleteOriginals) return result(item, { status: 'done', ...counts });

  // Deletes ignore cancellation: once started, the item finishes. Exactly the
  // copied keys are deleted, so an object added since the listing survives.
  const keys = copied.map((object) => object.key);
  try {
    const deleted = await ctx.source.deleteObjects(keys, false);
    for (const failure of deleted.failed) {
      failed.push({ key: failure.key, error: failure.message ?? 'Delete failed' });
      logger.warn(
        { source_bucket: request.sourceBucket, key: failure.key },
        'transfer original delete failed'
      );
    }
    return result(item, {
      status: deleted.failed.length === 0 ? 'done' : 'partial',
      ...counts,
      deletedOriginals: keys.length - deleted.failed.length
    });
  } catch (err) {
    // The call can fail after some batches were deleted; count what is really gone.
    const error = transferErrorMessage(err);
    failed.push({ key: item.sourceKey, error });
    logger.warn(
      { source_bucket: request.sourceBucket, key: item.sourceKey, error },
      'transfer original delete failed'
    );
    const remaining = await remainingKeys(item, keys, ctx).catch(() => null);
    return result(item, {
      status: 'partial',
      ...counts,
      deletedOriginals: remaining === null ? 0 : keys.length - remaining
    });
  }
}

/** How many of `keys` still exist in the source, after a failed delete call. */
async function remainingKeys(
  item: ResolvedItem,
  keys: string[],
  ctx: TransferContext
): Promise<number> {
  if (item.kind === 'file') return (await ctx.source.exists(item.sourceKey)) ? 1 : 0;
  const wanted = new Set(keys);
  let remaining = 0;
  await ctx.source.listAllKeysProgressively(item.sourceKey, (batch) => {
    for (const { key } of batch) if (wanted.has(key)) remaining++;
  });
  return remaining;
}

/**
 * Run a validated transfer: resolve every item, then copy (and for a move or
 * rename, delete the originals of) one item after another. Never throws: every
 * item ends in an `item-done` event and the last event is always `complete`.
 */
export async function executeTransfer(
  request: TransferRequest,
  ctx: TransferContext
): Promise<{ items: TransferItemResult[]; summary: TransferSummary }> {
  const started = Date.now();
  const { signal, logger } = ctx;
  const results: TransferItemResult[] = [];
  const summary = emptySummary();
  const finish = (itemResult: TransferItemResult) => {
    results.push(itemResult);
    summary[itemResult.status]++;
    ctx.emit({ type: 'item-done', ...itemResult });
    logger.debug(
      {
        op: request.op,
        source_key: itemResult.sourceKey,
        dest_root: itemResult.destRoot,
        status: itemResult.status,
        reason: itemResult.reason,
        copied: itemResult.copied,
        failed: itemResult.failed.length,
        deleted_originals: itemResult.deletedOriginals
      },
      'transfer item finished'
    );
  };

  let resolved: ResolvedItem[] = [];
  try {
    resolved = await resolveItems(request, ctx.dest, {
      mode: 'execute',
      concurrency: ctx.concurrency,
      signal
    });
  } catch (err) {
    logger.error({ op: request.op, err }, 'transfer resolution failed');
    const error = transferErrorMessage(err);
    for (const { sourceKey } of request.items) {
      finish({
        sourceKey,
        status: signal.aborted ? 'cancelled' : 'failed',
        copied: 0,
        failed: signal.aborted ? [] : [{ key: sourceKey, error }],
        deletedOriginals: 0
      });
    }
  }

  for (const item of resolved) {
    if (item.refused) {
      finish(result(item, { status: 'refused', reason: item.refused }));
    } else if (signal.aborted) {
      finish(result(item, { status: 'cancelled' }));
    } else if (item.error) {
      finish(
        result(item, { status: 'failed', failed: [{ key: item.sourceKey, error: item.error }] })
      );
    } else {
      try {
        finish(await runItem(item, request, ctx));
      } catch (err) {
        // runItem handles provider errors itself; this is a bug, not a storage failure.
        logger.error({ op: request.op, source_key: item.sourceKey, err }, 'transfer item crashed');
        finish(
          result(item, {
            status: 'failed',
            failed: [{ key: item.sourceKey, error: transferErrorMessage(err) }]
          })
        );
      }
    }
  }

  ctx.emit({ type: 'complete', summary });
  logger.info(
    {
      op: request.op,
      source_bucket: request.sourceBucket,
      dest_bucket: request.destBucket,
      item_count: request.items.length,
      ...summary,
      duration_ms: Date.now() - started
    },
    'transfer completed'
  );
  return { items: results, summary };
}
