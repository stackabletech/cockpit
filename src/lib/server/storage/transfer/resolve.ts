import type { StorageProvider } from '../provider.js';
import { numberedName } from '$lib/storage/numbered-name.js';
import { ConflictRenameNameSchema, StorageObjectKeySchema } from '$lib/storage/schemas.js';
import { keyToName, parentPrefix } from '$lib/storage/utils.js';
import {
  MAX_TRANSFER_ITEMS,
  type PlanItem,
  type RefusalReason,
  type TransferItemKind,
  type TransferItemRequest,
  type TransferOp
} from '$lib/storage/transfer-types.js';
import { runPool } from './pool.js';

/** A transfer within one storage connection. */
export interface TransferRequest {
  op: TransferOp;
  sourceBucket: string;
  /** Equal to `sourceBucket` for a rename. */
  destBucket: string;
  /** The folder copied or moved into; unused for a rename, which keeps each item's folder. */
  destPrefix: string;
  items: TransferItemRequest[];
}

/** A malformed request as a whole; answered with HTTP 400. */
export class TransferRequestError extends Error {}

export interface ResolvedItem {
  sourceKey: string;
  kind: TransferItemKind;
  /** Where the item lands by its name, before conflict handling. */
  baseDestKey: string;
  /** Where the item is written; differs from `baseDestKey` for `keepBoth`. */
  destKey: string;
  conflict: 'none' | TransferItemKind;
  selfConflict: boolean;
  refused?: RefusalReason;
  /** Execute only: the existence check failed, so the item cannot run. A plan throws instead. */
  error?: string;
  /** Plan only: first free numbered key, when conflicting. */
  suggestedKey?: string;
}

interface ResolveOptions {
  /** `plan` reports conflicts; `execute` applies each item's policy to them. */
  mode: 'plan' | 'execute';
  concurrency: number;
  signal?: AbortSignal;
}

/** `x` is inside `folder` when `folder` is a folder key and `x` starts with it. */
export function isInside(x: string, folder: string): boolean {
  return folder.endsWith('/') && x.startsWith(folder);
}

/**
 * Refuse requests that cannot be planned item by item: too many items,
 * duplicate sources, or one source inside another.
 */
export function validateTransferRequest(request: TransferRequest): void {
  const keys = request.items.map((item) => item.sourceKey);
  if (keys.length === 0) throw new TransferRequestError('No items');
  if (keys.length > MAX_TRANSFER_ITEMS) {
    throw new TransferRequestError(`At most ${MAX_TRANSFER_ITEMS} items per request`);
  }
  if (new Set(keys).size !== keys.length) throw new TransferRequestError('Duplicate source keys');
  const folders = keys.filter((key) => key.endsWith('/'));
  for (const key of keys) {
    if (folders.some((folder) => folder !== key && isInside(key, folder))) {
      throw new TransferRequestError('Overlapping source keys');
    }
  }
  if (request.op === 'rename' && request.destBucket !== request.sourceBucket) {
    throw new TransferRequestError('A rename stays in its bucket');
  }
}

/** The message of a provider error, which is usually a SvelteKit HttpError. */
export function transferErrorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'body' in err) {
    const body = (err as { body?: { message?: unknown } }).body;
    if (typeof body?.message === 'string') return body.message;
  }
  return err instanceof Error ? err.message : 'Unknown error';
}

/** File `a` and folder `a/` are different keys, so each kind has its own check. */
function destinationExists(dest: StorageProvider, key: string, signal?: AbortSignal) {
  return key.endsWith('/') ? dest.prefixExists(key, signal) : dest.exists(key);
}

/** Whether `key` exceeds the S3 limit of 1024 bytes of UTF-8. */
export function isTooLong(key: string): boolean {
  return !StorageObjectKeySchema.safeParse(key).success;
}

/** The item before any existence check: its destination by name and the refusals that need none. */
function resolveStatic(request: TransferRequest, item: TransferItemRequest): ResolvedItem {
  const { sourceKey, policy, name } = item;
  const kind: TransferItemKind = sourceKey.endsWith('/') ? 'folder' : 'file';
  const suffix = kind === 'folder' ? '/' : '';
  const renamed = request.op === 'rename' || policy === 'rename';
  const parent = request.op === 'rename' ? parentPrefix(sourceKey) : request.destPrefix;
  const baseDestKey = parent + (renamed ? (name ?? '') : keyToName(sourceKey)) + suffix;
  const resolved: ResolvedItem = {
    sourceKey,
    kind,
    baseDestKey,
    destKey: baseDestKey,
    conflict: 'none',
    selfConflict: false
  };

  const sameBucket = request.sourceBucket === request.destBucket;
  const refuse = (reason: RefusalReason) => ({ ...resolved, refused: reason });

  if (renamed && !ConflictRenameNameSchema.safeParse(name ?? '').success) {
    return refuse('invalid_name');
  }
  if (isTooLong(baseDestKey)) return refuse('name_too_long');
  if ((policy === 'replace' && kind !== 'file') || (policy === 'merge' && kind !== 'folder')) {
    return refuse('policy_mismatch');
  }
  if (sameBucket && baseDestKey === sourceKey) {
    // Only a copy can keep both; a move or rename onto itself does nothing.
    if (request.op !== 'copy') return refuse('same_location');
    return { ...resolved, selfConflict: true };
  }
  if (sameBucket && kind === 'folder' && isInside(baseDestKey, sourceKey)) {
    return refuse('into_itself');
  }
  return resolved;
}

/**
 * Resolve every item of a request to its destination, in request order.
 * Existence checks run through the concurrency pool first; duplicate
 * destinations and numbered names are then decided in order, so earlier
 * items count when later ones pick a name.
 */
export async function resolveItems(
  request: TransferRequest,
  dest: StorageProvider,
  options: ResolveOptions
): Promise<ResolvedItem[]> {
  const { mode, concurrency, signal } = options;
  const items = request.items.map((item) => resolveStatic(request, item));

  const exists = await runPool(
    items,
    concurrency,
    async (item) => {
      if (item.refused) return false;
      if (item.selfConflict) return true;
      try {
        return await destinationExists(dest, item.baseDestKey, signal);
      } catch (err) {
        if (mode === 'plan') throw err;
        item.error = transferErrorMessage(err);
        return false;
      }
    },
    signal
  );

  const sameBucket = request.sourceBucket === request.destBucket;
  const sources = request.items.map((item) => item.sourceKey);
  const claimed = new Set<string>();

  /** The first numbered key that exists neither in storage nor earlier in this request. */
  async function firstFree(base: string): Promise<string | null> {
    for (let counter = 1; ; counter++) {
      const candidate = numberedName(base, counter);
      if (isTooLong(candidate)) return null;
      if (claimed.has(candidate)) continue;
      if (!(await destinationExists(dest, candidate, signal))) return candidate;
    }
  }

  /**
   * Whether `destKey` equals, contains or is inside another source, or contains
   * the item's own source (a folder copied into one of its ancestors): writing
   * there would overwrite source objects, which a move then deletes.
   */
  function overlapsSource(destKey: string, index: number): boolean {
    if (!sameBucket) return false;
    return sources.some((source, j) =>
      j === index
        ? source !== destKey && isInside(source, destKey)
        : source === destKey || isInside(destKey, source) || isInside(source, destKey)
    );
  }

  for (const [index, item] of items.entries()) {
    if (item.refused || item.error || exists[index] === undefined) continue;
    if (exists[index]) item.conflict = item.kind;
    const policy = request.items[index].policy;

    try {
      if (mode === 'plan') {
        if (claimed.has(item.baseDestKey)) {
          item.refused = 'duplicate_destination';
          continue;
        }
        if (item.conflict !== 'none') {
          const suggested = await firstFree(item.baseDestKey);
          if (suggested) item.suggestedKey = suggested;
          // A self-conflicting copy is always kept as both, so it takes the numbered name.
          if (item.selfConflict) {
            if (!suggested) {
              item.refused = 'name_too_long';
              continue;
            }
            item.destKey = suggested;
          }
        }
      } else if (policy === 'keepBoth' && (item.conflict !== 'none' || claimed.has(item.destKey))) {
        const free = await firstFree(item.baseDestKey);
        if (!free) {
          item.refused = 'name_too_long';
          continue;
        }
        item.destKey = free;
      } else if (claimed.has(item.destKey)) {
        item.refused = 'duplicate_destination';
        continue;
      } else if (item.conflict !== 'none') {
        // `replace` and `merge` are the only policies that may write onto an existing key;
        // without a policy the conflict appeared after the plan, and a rename never overwrites.
        const allowed =
          request.op !== 'rename' &&
          (policy === 'replace' || policy === 'merge') &&
          !item.selfConflict;
        if (!allowed) {
          item.refused = item.selfConflict ? 'same_location' : 'conflict';
          continue;
        }
      }
    } catch (err) {
      if (mode === 'plan') throw err;
      item.error = transferErrorMessage(err);
      continue;
    }

    if (overlapsSource(item.destKey, index)) {
      item.refused = 'overlaps_source';
      continue;
    }
    // A suggestion is not claimed: the user may still pick replace or merge, and a
    // later item that really lands on that name must not be refused for it.
    claimed.add(item.destKey);
  }

  return items;
}

/** The plan response item for a resolved item. */
export function toPlanItem(item: ResolvedItem): PlanItem {
  return {
    sourceKey: item.sourceKey,
    kind: item.kind,
    destKey: item.baseDestKey,
    conflict: item.conflict,
    ...(item.selfConflict ? { selfConflict: true as const } : {}),
    ...(item.refused ? { refused: item.refused } : {}),
    ...(item.suggestedKey ? { suggestedName: keyToName(item.suggestedKey) } : {})
  };
}
