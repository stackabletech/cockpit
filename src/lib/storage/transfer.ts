/**
 * Client side of the transfer API: run one copy, move or rename request,
 * track it as an operation, and turn its per-item results into one toast.
 */

import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { randomUUID } from '$lib/utils/uuid.js';
import type { StorageApi } from './api.js';
import type { OperationsState } from './operations.svelte.js';
import type { OperationType } from './types.js';
import { keyToName } from './utils.js';
import {
  MAX_TRANSFER_ITEMS,
  type RefusalReason,
  type TransferBody,
  type TransferItemResult,
  type TransferItemStatus,
  toItemResult
} from './transfer-types.js';

/** A stream that ended without `complete` is read back from the job this often. */
const JOB_POLL_INTERVAL_MS = 2000;
/** Names listed in a toast before "+ N more". */
const TOAST_NAME_LIMIT = 3;

export { MAX_TRANSFER_ITEMS };

/**
 * An item result as the client knows it. `unknown`: the item was sent but no
 * result arrived, neither from the stream nor from the job (e.g. the
 * connection dropped and the job expired). It may still have been transferred.
 */
export type ItemOutcome = Omit<TransferItemResult, 'status'> & {
  status: TransferItemStatus | 'unknown';
};
type OutcomeStatus = ItemOutcome['status'];

export function refusalMessage(reason: RefusalReason): string {
  switch (reason) {
    case 'same_location':
      return m.storage_transfer_reason_same_location();
    case 'into_itself':
      return m.storage_transfer_reason_into_itself();
    case 'overlaps_source':
      return m.storage_transfer_reason_overlaps_source();
    case 'duplicate_destination':
      return m.storage_transfer_reason_duplicate_destination();
    case 'conflict':
      return m.storage_transfer_reason_conflict();
    case 'policy_mismatch':
      return m.storage_transfer_reason_policy_mismatch();
    case 'invalid_name':
      return m.storage_transfer_reason_invalid_name();
    case 'name_too_long':
      return m.storage_transfer_reason_name_too_long();
  }
}

function itemProblem(item: ItemOutcome): string {
  if (item.status === 'unknown') return m.storage_transfer_item_unknown();
  if (item.status === 'refused' && item.reason) return refusalMessage(item.reason);
  if (item.status === 'partial') return m.storage_transfer_item_partial();
  if (item.status === 'cancelled') return m.storage_transfer_item_cancelled();
  return m.storage_transfer_item_failed();
}

const STATUS_ORDER: OutcomeStatus[] = [
  'done',
  'partial',
  'failed',
  'refused',
  'cancelled',
  'unknown'
];

function statusCount(status: OutcomeStatus, count: number): string {
  switch (status) {
    case 'unknown':
      return m.storage_transfer_status_unknown({ count });
    case 'done':
      return m.storage_transfer_status_done({ count });
    case 'partial':
      return m.storage_transfer_status_partial({ count });
    case 'failed':
      return m.storage_transfer_status_failed({ count });
    case 'refused':
      return m.storage_transfer_status_refused({ count });
    case 'cancelled':
      return m.storage_transfer_status_cancelled({ count });
  }
}

/**
 * Exactly one toast per paste or move, worded after the user's action (a cut
 * pasted is still a paste). All `done` gives a success toast with the count;
 * otherwise counts per status and the first few affected names with their
 * reason. Nothing is shown when no item was sent.
 */
export function toastTransferResults(action: 'paste' | 'move', results: ItemOutcome[]): void {
  if (results.length === 0) return;
  const counts = new Map<OutcomeStatus, number>();
  for (const item of results) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  const done = counts.get('done') ?? 0;

  if (done === results.length) {
    addToast(
      'success',
      action === 'paste'
        ? m.storage_action_paste_success({ count: done })
        : m.storage_action_move_success({ count: done })
    );
    return;
  }

  const countText = STATUS_ORDER.filter((status) => counts.has(status))
    .map((status) => statusCount(status, counts.get(status)!))
    .join(', ');
  // Items with an unknown outcome may have been transferred, so they never read as "could not".
  const anyProgress = done > 0 || counts.has('partial') || counts.has('unknown');
  const summary = anyProgress
    ? action === 'paste'
      ? m.storage_transfer_summary_paste({ counts: countText })
      : m.storage_transfer_summary_move({ counts: countText })
    : action === 'paste'
      ? m.storage_transfer_failed_paste({ counts: countText })
      : m.storage_transfer_failed_move({ counts: countText });
  const affected = results.filter((item) => item.status !== 'done');
  const lines = affected
    .slice(0, TOAST_NAME_LIMIT)
    .map((item) =>
      m.storage_transfer_item_line({ name: keyToName(item.sourceKey), reason: itemProblem(item) })
    );
  if (affected.length > TOAST_NAME_LIMIT) {
    lines.push(m.storage_transfer_more({ count: affected.length - TOAST_NAME_LIMIT }));
  }
  addToast(anyProgress ? 'warning' : 'error', [summary, ...lines].join(' '), 8000);
}

export interface RunTransferOptions {
  api: StorageApi;
  operations: OperationsState;
  body: Omit<TransferBody, 'jobId'>;
  /** Operation panel entry. */
  label: string;
  type: OperationType;
  destPath: string;
}

function operationStatus(results: ItemOutcome[]): 'done' | 'error' | 'cancelled' {
  if (results.some((item) => item.status === 'unknown')) return 'error';
  if (results.some((item) => item.status === 'cancelled')) return 'cancelled';
  return results.every((item) => item.status === 'done') ? 'done' : 'error';
}

async function waitForJob(api: StorageApi, jobId: string): Promise<TransferItemResult[] | null> {
  while (true) {
    const job = await api.readTransferJob(jobId);
    if (job.status === 'not_found') return null;
    if (job.status !== 'running') return job.items ?? [];
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_INTERVAL_MS));
  }
}

/**
 * Send one transfer request and follow it in the operations panel. Cancelling
 * the operation cancels the job on the server; the stream still reports what
 * happened to each item. If the stream ends without `complete`, the results
 * are read from the job. Throws a StorageError for request-level HTTP errors
 * (invalid request, feature disabled, no connection).
 */
export async function runTransfer(options: RunTransferOptions): Promise<ItemOutcome[]> {
  const { api, operations, body } = options;
  const opId = randomUUID();
  const jobId = randomUUID();
  const sourceNames = body.items.map((item) => keyToName(item.sourceKey));

  operations.startOp(
    opId,
    options.label,
    options.type,
    body.items.length,
    undefined,
    options.destPath,
    sourceNames
  );
  operations.updateOpJobIds(opId, [jobId]);

  const results: TransferItemResult[] = [];
  let totalBytes = 0;
  let finishedBytes = 0;
  // Items run concurrently on the server, so their events interleave.
  const running = new Map<string, { total: number; copied: number }>();
  let currentName = '';

  let complete: boolean;
  try {
    ({ complete } = await api.transfer({ ...body, jobId }, (event) => {
      switch (event.type) {
        case 'item-start':
          totalBytes += event.totalBytes;
          running.set(event.sourceKey, { total: event.totalBytes, copied: 0 });
          currentName = keyToName(event.sourceKey);
          break;
        case 'progress': {
          const item = running.get(event.sourceKey);
          if (item) item.copied = event.copiedBytes;
          break;
        }
        case 'item-done': {
          const item = toItemResult(event);
          results.push(item);
          const started = running.get(event.sourceKey);
          if (started) {
            finishedBytes += item.status === 'done' ? started.total : started.copied;
            running.delete(event.sourceKey);
          }
          // Show an item that is still running rather than one that just finished.
          const [next] = running.keys();
          if (next !== undefined) currentName = keyToName(next);
          break;
        }
        case 'complete':
          return;
      }
      let runningBytes = 0;
      for (const item of running.values()) runningBytes += item.copied;
      operations.updateOpProgress(
        opId,
        results.length,
        finishedBytes + runningBytes,
        currentName,
        totalBytes
      );
    }));
  } catch (err) {
    operations.finishOp(opId, 'error');
    throw err;
  }

  let reported: TransferItemResult[] = results;
  if (!complete) {
    const fromJob = await waitForJob(api, jobId).catch(() => null);
    if (fromJob) reported = fromJob;
  }
  // Every sent item gets an outcome, in request order; one without a result is unknown.
  const bySource = new Map(reported.map((item) => [item.sourceKey, item]));
  const finalResults: ItemOutcome[] = body.items.map(
    ({ sourceKey }) =>
      bySource.get(sourceKey) ?? {
        sourceKey,
        status: 'unknown',
        copied: 0,
        failed: [],
        deletedOriginals: 0
      }
  );

  await tick();
  operations.finishOp(opId, operationStatus(finalResults));
  return finalResults;
}
