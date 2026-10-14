/**
 * Wire types of the transfer API (`/api/storage/transfer` and its `/plan`).
 * Shared by the server engine and the client; the server sends codes, the
 * client turns them into messages.
 */

/** At most this many selected items per plan or transfer request. */
export const MAX_TRANSFER_ITEMS = 1000;

export type TransferOp = 'copy' | 'move' | 'rename';

/** How a conflicting item is resolved. Skipped items are left out of the request. */
export type TransferPolicy = 'replace' | 'merge' | 'keepBoth' | 'rename';

export type RefusalReason =
  | 'same_location'
  | 'into_itself'
  | 'overlaps_source'
  | 'duplicate_destination'
  | 'conflict'
  | 'policy_mismatch'
  | 'invalid_name'
  | 'name_too_long';

export type TransferItemStatus = 'done' | 'partial' | 'failed' | 'refused' | 'cancelled';

export type TransferItemKind = 'file' | 'folder';

export interface TransferItemRequest {
  sourceKey: string;
  policy?: TransferPolicy;
  /** The new name (one path segment) for `policy: 'rename'` and `op: 'rename'`. */
  name?: string;
}

export interface PlanItem {
  sourceKey: string;
  kind: TransferItemKind;
  destKey: string;
  conflict: 'none' | TransferItemKind;
  /** A copy onto itself; the client applies `keepBoth` without asking. */
  selfConflict?: true;
  refused?: RefusalReason;
  /** First free numbered name (one path segment), when conflicting. */
  suggestedName?: string;
}

export interface TransferObjectFailure {
  key: string;
  error: string;
}

export interface TransferItemResult {
  sourceKey: string;
  destRoot?: string;
  status: TransferItemStatus;
  reason?: RefusalReason;
  copied: number;
  failed: TransferObjectFailure[];
  deletedOriginals: number;
}

export type TransferSummary = Record<TransferItemStatus, number>;

export type TransferEvent =
  | {
      type: 'item-start';
      sourceKey: string;
      destRoot: string;
      totalObjects: number;
      totalBytes: number;
    }
  | { type: 'progress'; sourceKey: string; copiedObjects: number; copiedBytes: number }
  | ({ type: 'item-done' } & TransferItemResult)
  | { type: 'complete'; summary: TransferSummary };

/** Body of `POST /api/storage/transfer/plan`. */
export interface TransferPlanBody {
  op: 'copy' | 'move';
  source: { bucket: string; keys: string[] };
  dest: { bucket: string; prefix: string };
}

/** Body of `POST /api/storage/transfer`. */
export interface TransferBody {
  op: TransferOp;
  jobId: string;
  source: { bucket: string };
  /** Required for copy and move; a rename keeps each item in its folder. */
  dest?: { bucket: string; prefix: string };
  items: TransferItemRequest[];
}

/** What `GET /api/storage/copy/job/[jobId]` reports for a transfer job. */
export interface TransferJobState {
  status: 'running' | 'done' | 'error' | 'cancelled' | 'not_found';
  items?: TransferItemResult[];
}

/** The item result carried by an `item-done` event. */
export function toItemResult(
  event: Extract<TransferEvent, { type: 'item-done' }>
): TransferItemResult {
  const { sourceKey, destRoot, status, reason, copied, failed, deletedOriginals } = event;
  return { sourceKey, destRoot, status, reason, copied, failed, deletedOriginals };
}
