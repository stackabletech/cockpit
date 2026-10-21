import { error } from '@sveltejs/kit';
import type pino from 'pino';
import {
  storageMoveEnabled,
  storagePasteEnabled,
  storageRenameEnabled
} from '$lib/server/feature-flags.js';
import { storageTransferDuration, storageTransferItemsTotal } from '$lib/server/metrics.js';
import type { StorageProvider } from '../provider.js';
import {
  createJob,
  failJob,
  finishJob,
  recordJobItem,
  setJobCancellation,
  touchJob
} from '../job-store.js';
import { toItemResult, type TransferEvent, type TransferOp } from '$lib/storage/transfer-types.js';
import { executeTransfer } from './execute.js';
import { TransferRequestError, validateTransferRequest, type TransferRequest } from './resolve.js';

/** A running transfer refreshes its job this often, so no copy expires mid-transfer. */
const HEARTBEAT_INTERVAL_MS = 60_000;

/** Whether the feature flags allow `op`: copy needs paste, move needs move or paste, rename needs rename. */
export function transferAllowed(op: TransferOp): boolean {
  if (op === 'copy') return storagePasteEnabled;
  if (op === 'move') return storageMoveEnabled || storagePasteEnabled;
  return storageRenameEnabled;
}

/** Throws 404 when the feature flags do not allow `op`. */
export function requireTransferAllowed(op: TransferOp, logger: pino.Logger, userId?: string): void {
  if (transferAllowed(op)) return;
  logger.warn({ operation: op, user_id: userId }, 'storage operation rejected: feature disabled');
  throw error(404, `Storage ${op} is disabled`);
}

/** Validates a request as a whole, mapping its problems to HTTP 400. */
export function requireValidTransfer(request: TransferRequest): void {
  try {
    validateTransferRequest(request);
  } catch (err) {
    if (err instanceof TransferRequestError) throw error(400, err.message);
    throw err;
  }
}

interface StreamTransferOptions {
  request: TransferRequest;
  jobId: string;
  userId: string;
  source: StorageProvider;
  dest: StorageProvider;
  concurrency: number;
  logger: pino.Logger;
}

/**
 * Start a transfer and answer with its NDJSON events. The transfer runs to its
 * end even if the client disconnects; only cancelling its job cancels it. The
 * job route is shared by all storage jobs (transfers and downloads) and lives at
 * `/api/storage/copy/job/[jobId]` for historical reasons: `DELETE` cancels, `GET`
 * reads the job. Every item result is recorded in the job, so a client that lost
 * the stream can read them back. Throws 409 if the job ID was used before.
 */
export function streamTransfer(options: StreamTransferOptions): Response {
  const { request, jobId, userId, logger } = options;
  createJob(jobId, userId, { allowRestart: false, cancelSettles: false });

  const controller = new AbortController();
  setJobCancellation(jobId, () => controller.abort());
  const heartbeat = setInterval(() => touchJob(jobId), HEARTBEAT_INTERVAL_MS);
  heartbeat.unref?.();

  const encoder = new TextEncoder();
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  // `start` runs synchronously, so the controller exists before the engine emits.
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      streamController = c;
    }
  });
  const closeStream = () => {
    try {
      streamController.close();
    } catch {
      // Already closed or the client disconnected.
    }
  };
  const emit = (event: TransferEvent) => {
    if (event.type === 'item-done') {
      recordJobItem(jobId, toItemResult(event));
      storageTransferItemsTotal.inc({ op: request.op, status: event.status });
    }
    try {
      streamController.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
    } catch {
      // Client disconnected — the transfer continues and is readable from the job.
    }
    if (event.type === 'complete') closeStream();
  };

  const stopTimer = storageTransferDuration.startTimer({ op: request.op });
  void executeTransfer(request, {
    source: options.source,
    dest: options.dest,
    concurrency: options.concurrency,
    signal: controller.signal,
    logger: logger.child({ job_id: jobId }),
    emit
  })
    .then(
      ({ summary }) => finishJob(jobId, { summary }),
      (err) => {
        // The engine never throws; if it does, the stream ends without `complete`
        // and the client reads the recorded items from the job.
        logger.error({ err, job_id: jobId }, 'transfer crashed');
        failJob(jobId, 'Transfer crashed');
        closeStream();
      }
    )
    .finally(() => {
      clearInterval(heartbeat);
      stopTimer();
    });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
}
