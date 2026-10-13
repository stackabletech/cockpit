import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import type { StoragePage, ClipboardData, ModalType } from '$lib/storage/types.js';
import type { ConflictEntry } from '$lib/components/storage/modals/shared/conflict-types.js';
import { keyToName } from '$lib/storage/utils.js';
import { ConflictRenameNameSchema } from '$lib/storage/schemas.js';
import { StorageError, getActionErrorMessage } from './errors.js';
import { pageUnloading } from './operations.svelte.js';
import { storageMoveEnabled } from '$lib/client/feature-flags.js';
import { OperationsState } from './operations.svelte.js';
import type { StorageApi } from './api.js';

// ── Internal types ──────────────────────────────────────────────────────────

type PendingPasteOp = {
  type: 'paste';
  keys: string[];
  sourceBucket: string;
  destBucket: string;
  destPrefix: string;
  wasCut: boolean;
  fileSizes: Record<string, number>;
  sourcePrefix: string;
  totalBytes: number;
};

type PendingMoveOp = {
  type: 'move';
  keys: string[];
  destPrefix: string;
  destBucket: string;
  items: Array<{ key: string; name: string; isDirectory: boolean; size?: number }>;
  sourcePrefix: string | null;
  totalBytes: number;
};

/** A conflict rename that failed, or (`partial`) moved only some of a folder's objects. */
type RenameError = { name: string; newName: string; partial?: boolean };

type PendingConflictOp = PendingPasteOp | PendingMoveOp | null;

// ── Callbacks interface ──────────────────────────────────────────────────────

export interface ClipboardStateCallbacks {
  getBucket: () => string;
  getPrefix: () => string;
  getObjects: () => StoragePage;
  getSelectedKeys: () => Iterable<string>;
  openModal: (type: ModalType, payload: unknown) => void;
  closeModal: () => void;
  refresh: () => void;
  invalidateSourceTabs: (prefix: string) => void;
  recordFileVisit: (bucket: string, key: string, size: number) => void;
  removeFiles: (bucket: string, keys: string[]) => void;
  clearSelection: () => void;
}

// ── ClipboardState ───────────────────────────────────────────────────────────

export class ClipboardState {
  // ── Reactive state ───────────────────────────────────────────────────────

  /** Current clipboard content (null when empty). */
  clipboard = $state<ClipboardData | null>(null);

  /** Pending conflict operation awaiting user resolution. */
  private _pendingConflictOp = $state<PendingConflictOp>(null);

  /** Source prefix for the current pending move operation. */
  private _pendingSourcePrefix: string | null = null;

  /** Pending move operation (before user confirmation). */
  private _pendingMove: {
    keys: string[];
    destPrefix: string;
    destBucket: string;
    items: Array<{ key: string; name: string; isDirectory: boolean; size?: number }>;
    sourcePrefix: string | null;
  } | null = null;

  // ── Dependencies ──────────────────────────────────────────────────────────

  private _api: StorageApi;
  private _operations: OperationsState;
  private _callbacks: ClipboardStateCallbacks;

  constructor(api: StorageApi, operations: OperationsState, callbacks: ClipboardStateCallbacks) {
    this._api = api;
    this._operations = operations;
    this._callbacks = callbacks;
  }

  // ── Cut / Copy ─────────────────────────────────────────────────────────────

  /**
   * Returns true when `key` is in the clipboard with action='cut' and the
   * bucket matches.
   */
  isCutKey(key: string, bucket: string): boolean {
    return (
      this.clipboard?.action === 'cut' &&
      this.clipboard.sourceBucket === bucket &&
      this.clipboard.keys.includes(key)
    );
  }

  /**
   * Set clipboard with cut action.
   * Caller should check storageCutCopyEnabled before calling.
   */
  cut(selectedKeys: string[], objects: StoragePage, bucket: string, prefix: string): void {
    if (selectedKeys.length === 0) return;
    const fileSizes: Record<string, number> = {};
    for (const obj of objects.objects) {
      if (selectedKeys.includes(obj.key) && !obj.isDirectory) {
        fileSizes[obj.key] = obj.size;
      }
    }
    this.clipboard = {
      action: 'cut',
      keys: selectedKeys,
      sourceBucket: bucket,
      sourcePrefix: prefix,
      fileSizes
    };
    addToast('info', m.storage_action_cut_success({ count: selectedKeys.length }));
  }

  /**
   * Set clipboard with copy action.
   * Caller should check storageCutCopyEnabled before calling.
   */
  copy(selectedKeys: string[], objects: StoragePage, bucket: string, prefix: string): void {
    if (selectedKeys.length === 0) return;
    const fileSizes: Record<string, number> = {};
    for (const obj of objects.objects) {
      if (selectedKeys.includes(obj.key) && !obj.isDirectory) {
        fileSizes[obj.key] = obj.size;
      }
    }
    this.clipboard = {
      action: 'copy',
      keys: selectedKeys,
      sourceBucket: bucket,
      sourcePrefix: prefix,
      fileSizes
    };
    addToast('info', m.storage_action_copy_success({ count: selectedKeys.length }));
  }

  // ── Paste ──────────────────────────────────────────────────────────────────

  /**
   * Execute a paste operation into the given destination prefix.
   * Caller should check storagePasteEnabled and clipboard non-empty first.
   */
  async paste(destPrefix: string): Promise<void> {
    const bucket = this._callbacks.getBucket();
    const pasteClipboard = this.clipboard;
    if (!pasteClipboard) return;

    // A folder pasted into itself would copy (or replace) its own subtree.
    if (
      pasteClipboard.sourceBucket === bucket &&
      pasteClipboard.keys.some((key) => this._isFolderIntoItself(key, destPrefix))
    ) {
      addToast('warning', m.storage_action_paste_into_itself_error());
      return;
    }

    const wasCut = pasteClipboard.action === 'cut';
    // Moving an item into the folder it already lives in is a no-op.
    const pasteKeys = pasteClipboard.keys.filter(
      (key) => !wasCut || !this._isSelfDestination(key, destPrefix, pasteClipboard.sourceBucket)
    );
    if (pasteKeys.length === 0) return;

    // ── Check for name conflicts at destination ──────────────────────
    const conflictEntries = await this._checkDestinationConflicts(
      pasteKeys,
      destPrefix,
      bucket,
      pasteClipboard.sourceBucket
    );
    const hasConflicts = conflictEntries.some((e) => e.conflict);
    if (hasConflicts) {
      const totalBytes = pasteKeys.reduce((sum, k) => sum + (pasteClipboard.fileSizes[k] ?? 0), 0);
      this._pendingConflictOp = {
        type: 'paste',
        keys: pasteKeys,
        sourceBucket: pasteClipboard.sourceBucket,
        destBucket: bucket,
        destPrefix,
        wasCut,
        fileSizes: pasteClipboard.fileSizes,
        sourcePrefix: pasteClipboard.sourcePrefix,
        totalBytes
      };
      this._callbacks.openModal('resolve-conflicts', {
        entries: conflictEntries,
        bucket,
        destPrefix,
        confirmLabel: m.storage_action_paste()
      });
      return;
    }

    const opId = crypto.randomUUID();
    const abortController = new AbortController();
    const sourceNames = pasteKeys.map((k) => keyToName(k));
    const isSinglePaste = sourceNames.length === 1;
    const pasteLabel = isSinglePaste
      ? `${m.storage_operation_paste_one({ count: 1 })}: ${sourceNames[0]}`
      : `${m.storage_operation_paste_other({ count: sourceNames.length })}: ${sourceNames[0]} + ${sourceNames.length - 1} more`;

    const totalBytes = pasteKeys.reduce((sum, k) => sum + (pasteClipboard.fileSizes[k] ?? 0), 0);
    this._operations.startOp(
      opId,
      pasteLabel,
      'paste',
      pasteKeys.length,
      abortController,
      `${bucket}/${destPrefix}`,
      sourceNames,
      totalBytes
    );
    try {
      let completedBytes = 0;
      const fileSizes = pasteClipboard?.fileSizes ?? {};
      const pasteSourceNames = pasteKeys.map((k) => keyToName(k));
      const fileJobIdsAccum: string[] = [];
      const { results, failed } = await this._performPasteSequential(
        pasteKeys,
        pasteClipboard.sourceBucket,
        destPrefix,
        wasCut,
        abortController.signal,
        (index, key) => {
          // File-level progress: use the known file size from clipboard.

          completedBytes += fileSizes[key] ?? 0;
          this._operations.updateOpProgress(opId, index, completedBytes, keyToName(key));
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (loaded, _total) => {
          // Byte-level progress during a large file's streaming upload.
          const prevFiles =
            this._operations.operations.find((op) => op.id === opId)?.completedCount ?? 0;
          let prevBytes = 0;
          for (let j = 0; j < prevFiles && j < pasteKeys.length; j++) {
            prevBytes += fileSizes[pasteKeys[j]] ?? 0;
          }
          this._operations.updateOpProgress(
            opId,
            prevFiles,
            prevBytes + loaded,

            pasteSourceNames[prevFiles] ?? ''
          );
        },
        (index, jobId) => {
          fileJobIdsAccum[index] = jobId;
          this._operations.updateOpJobIds(opId, [...fileJobIdsAccum]);
        }
      );
      await tick();
      if (results.length === 0) {
        this._operations.finishOp(opId, 'error');
        addToast('error', m.storage_action_paste_error_source_not_found());
        return;
      }
      this._operations.finishOp(opId, failed > 0 ? 'error' : 'done');
      // Record destination files as recent visits
      const newFileSizes: Record<string, number> = {};
      for (const r of results) {
        if (r.destKey.endsWith('/')) continue;
        const size = pasteClipboard.fileSizes?.[r.sourceKey] ?? 0;
        newFileSizes[r.destKey] = size;
        this._callbacks.recordFileVisit(bucket, r.destKey, size);
      }
      if (failed > 0) {
        addToast('warning', m.storage_action_paste_partial({ count: failed }));
      } else {
        addToast('success', m.storage_action_paste_success({ count: results.length }));
      }
      if (wasCut) {
        this._pointClipboardAtMovedItems(
          results.map((r) => r.destKey),
          newFileSizes,
          pasteClipboard.sourcePrefix
        );
      }
      this._callbacks.refresh();
      // Invalidate background tabs viewing the destination
      this._callbacks.invalidateSourceTabs(destPrefix);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._operations.finishOp(opId, 'cancelled');
        return;
      }
      if (pageUnloading) {
        // Page is unloading — server-side copies continue regardless.
        return;
      }
      this._operations.finishOp(opId, 'error');
      addToast(
        'error',
        err instanceof StorageError ? getActionErrorMessage(err) : m.storage_action_paste_error()
      );
    }
  }

  // ── Move (drag-and-drop) ───────────────────────────────────────────────────

  /** Validate a drag-and-drop move and open the confirmation dialog. */
  performMove = (
    destPrefix: string,
    keys?: string[],
    destBucket = this._callbacks.getBucket()
  ): void => {
    if (!storageMoveEnabled) return;
    const objects = this._callbacks.getObjects();
    const requestedKeys = keys ?? [...this._callbacks.getSelectedKeys()];
    const moveKeys = requestedKeys.filter(
      (key) => !this._isSelfDestination(key, destPrefix, destBucket)
    );
    if (moveKeys.length === 0) return;

    // Don't move items that are already directly inside destPrefix (no-op).
    // Don't move a folder into itself
    if (
      destBucket === this._callbacks.getBucket() &&
      moveKeys.some((k) => this._isFolderIntoItself(k, destPrefix))
    ) {
      return;
    }

    // Collect per-item metadata for the confirmation dialog
    const items = moveKeys.map((key) => {
      const obj = objects.objects.find((o) => o.key === key);
      return {
        key,
        name: keyToName(key),
        isDirectory: key.endsWith('/'),
        size: obj && !obj.isDirectory ? obj.size : undefined
      };
    });

    const sourcePrefix = this._commonPrefix(moveKeys);
    this._pendingMove = { keys: moveKeys, destPrefix, destBucket, items, sourcePrefix };
    this._pendingSourcePrefix = sourcePrefix;
    this._callbacks.openModal('confirm-move', { keys: moveKeys, destPrefix, items });
  };

  confirmMove = async (): Promise<void> => {
    if (!this._pendingMove) return;
    const { keys: moveKeys, destPrefix, destBucket, items } = this._pendingMove;
    this._pendingMove = null;
    this._callbacks.closeModal();

    const bucket = this._callbacks.getBucket();

    // ── Check for name conflicts at destination ──────────────────────────
    const conflictEntries = await this._checkDestinationConflicts(
      moveKeys,
      destPrefix,
      destBucket,
      bucket
    );
    const hasConflicts = conflictEntries.some((e) => e.conflict);
    if (hasConflicts) {
      const totalBytes = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
      this._pendingConflictOp = {
        type: 'move',
        keys: moveKeys,
        destPrefix,
        destBucket,
        items,
        sourcePrefix: this._pendingSourcePrefix,
        totalBytes
      };
      this._callbacks.openModal('resolve-conflicts', {
        entries: conflictEntries,
        bucket: destBucket,
        destPrefix,
        confirmLabel: m.storage_action_move()
      });
      return;
    }

    const opId = crypto.randomUUID();
    const abortController = new AbortController();
    const sourceNames = moveKeys.map((k) => keyToName(k));
    const totalBytes = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
    const isSingleMove = sourceNames.length === 1;
    const moveLabel = isSingleMove
      ? `${m.storage_operation_move_one({ count: 1 })}: ${sourceNames[0]}`
      : `${m.storage_operation_move_other({ count: sourceNames.length })}: ${sourceNames[0]} + ${sourceNames.length - 1} more`;
    this._operations.startOp(
      opId,
      moveLabel,
      'move',
      moveKeys.length,
      abortController,
      `${destBucket}/${destPrefix}`,
      sourceNames,
      totalBytes
    );

    try {
      const results: Array<{ sourceKey: string; destKey: string }> = [];
      let failed = 0;
      const fileJobIds: string[] = [];

      for (let i = 0; i < moveKeys.length; i++) {
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        const sourceKey = moveKeys[i];
        const fileJobId = crypto.randomUUID();
        fileJobIds.push(fileJobId);
        this._operations.updateOpJobIds(opId, [...fileJobIds]);

        try {
          const result = await this._api.move({
            bucket: destBucket,
            sourceBucket: bucket,
            sourceKeys: [sourceKey],
            destinationPrefix: destPrefix,
            progress: true,
            jobId: fileJobId,
            signal: abortController.signal,
            callbacks: {
              onProgress: (_sourceKey, _destKey, loaded) => {
                const prevBytes = results.reduce((sum, r) => {
                  const item = items.find((it) => it.key === r.sourceKey);
                  return sum + (item?.size ?? 0);
                }, 0);
                this._operations.updateOpProgress(
                  opId,
                  i + 1,
                  prevBytes + loaded,
                  keyToName(sourceKey)
                );
              },
              onComplete: (finalResults, finalFailed) => {
                if (finalResults.length > 0) {
                  results.length = 0;
                  results.push(...finalResults);
                }
                if (finalFailed.length > 0) {
                  failed = finalFailed.length;
                }
              }
            }
          });
          results.push(...result.results);
          failed += result.failed;
          const completedBytes = results.reduce((sum, r) => {
            const item = items.find((it) => it.key === r.sourceKey);
            return sum + (item?.size ?? 0);
          }, 0);
          this._operations.updateOpProgress(opId, i + 1, completedBytes, keyToName(sourceKey));
        } catch {
          failed++;
        }
      }

      await tick();
      this._operations.finishOp(opId, failed === 0 ? 'done' : 'error');

      if (results.length > 0) {
        addToast('success', m.storage_action_move_success({ count: results.length }));
        const movedKeys = results.map((r) => r.sourceKey).filter((k) => !k.endsWith('/'));
        if (movedKeys.length > 0) {
          this._callbacks.removeFiles(bucket, movedKeys);
        }
        for (const r of results) {
          if (!r.destKey.endsWith('/')) {
            const item = items.find((it) => it.key === r.sourceKey);
            if (item && item.size) {
              this._callbacks.recordFileVisit(destBucket, r.destKey, item.size);
            }
          }
        }
      }
      if (failed > 0) {
        addToast('warning', m.storage_action_move_partial({ count: failed }));
      }

      this._callbacks.clearSelection();
      if (this._pendingSourcePrefix !== null) {
        this._callbacks.invalidateSourceTabs(this._pendingSourcePrefix);
        this._pendingSourcePrefix = null;
      }
      // Invalidate background tabs viewing the destination
      this._callbacks.invalidateSourceTabs(destPrefix);
      this._callbacks.refresh();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._operations.finishOp(opId, 'cancelled');
        this._pendingSourcePrefix = null;
        return;
      }
      if (pageUnloading) {
        return;
      }
      this._operations.finishOp(opId, 'error');
      this._pendingSourcePrefix = null;
      addToast('error', m.storage_action_move_error());
    }
  };

  cancelMove = (): void => {
    this._pendingMove = null;
    this._callbacks.closeModal();
  };

  // ── Conflict resolution ────────────────────────────────────────────────────

  confirmConflictResolution = async (resolvedEntries: ConflictEntry[]): Promise<void> => {
    const pending = this._pendingConflictOp;
    if (!pending) return;
    this._pendingConflictOp = null;
    this._callbacks.closeModal();

    if (pending.type === 'paste') {
      await this._executePasteWithConflicts(pending, resolvedEntries);
    } else {
      await this._executeMoveWithConflicts(pending, resolvedEntries);
    }
  };

  cancelConflictResolution = (): void => {
    this._pendingConflictOp = null;
    this._callbacks.closeModal();
  };

  // ── Clipboard cleanup ──────────────────────────────────────────────────────

  /**
   * Remove deleted keys from the clipboard after a delete operation.
   * Called after performDelete in StorageState.
   */
  removeDeletedKeys(bucket: string, keys: string[]): void {
    if (this.clipboard && this.clipboard.sourceBucket === bucket) {
      const remainingKeys = this.clipboard.keys.filter((k) => !keys.includes(k));
      if (remainingKeys.length !== this.clipboard.keys.length) {
        if (remainingKeys.length === 0) {
          this.clipboard = null;
        } else {
          const remainingSizes: Record<string, number> = {};
          for (const k of remainingKeys) {
            if (this.clipboard.fileSizes[k] !== undefined) {
              remainingSizes[k] = this.clipboard.fileSizes[k];
            }
          }
          this.clipboard = { ...this.clipboard, keys: remainingKeys, fileSizes: remainingSizes };
        }
      }
    }
  }

  // ── Private: Paste helpers ─────────────────────────────────────────────────

  private async _performPaste(
    keys: string[],
    sourceBucket: string,
    destPrefix: string,
    deleteOriginals = false,
    signal?: AbortSignal
  ): Promise<{
    results: Array<{ sourceKey: string; destKey: string }>;
    failed: number;
  }> {
    if (deleteOriginals) {
      return this._api.move({
        bucket: this._callbacks.getBucket(),
        sourceBucket,
        sourceKeys: keys,
        destinationPrefix: destPrefix,
        signal
      });
    }
    return this._api.copy({
      bucket: this._callbacks.getBucket(),
      sourceBucket,
      sourceKeys: keys,
      destinationPrefix: destPrefix,
      signal
    });
  }

  /**
   * Process paste/move keys one at a time, calling `onFileComplete` after
   * each file so the caller can update byte-level progress.
   */
  private async _performPasteSequential(
    keys: string[],
    sourceBucket: string,
    destPrefix: string,
    deleteOriginals = false,
    signal?: AbortSignal,
    onFileComplete?: (index: number, key: string) => void,
    onFileProgress?: (loaded: number, total: number) => void,
    onFileJobId?: (index: number, jobId: string) => void
  ): Promise<{
    results: Array<{ sourceKey: string; destKey: string }>;
    failed: number;
    fileJobIds: string[];
  }> {
    const results: Array<{ sourceKey: string; destKey: string }> = [];
    let failed = 0;
    const fileJobIds: string[] = [];
    const moveFn = deleteOriginals
      ? (params: Parameters<StorageApi['move']>[0]) => this._api.move(params)
      : (params: Parameters<StorageApi['copy']>[0]) => this._api.copy(params);

    for (let i = 0; i < keys.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const sourceKey = keys[i];
      const fileJobId = crypto.randomUUID();
      fileJobIds.push(fileJobId);
      onFileJobId?.(i, fileJobId);

      try {
        const result = await moveFn({
          bucket: this._callbacks.getBucket(),
          sourceBucket,
          sourceKeys: [sourceKey],
          destinationPrefix: destPrefix,
          progress: true,
          jobId: fileJobId,
          signal,
          callbacks: {
            onProgress: onFileProgress
              ? (_sourceKey, _destKey, loaded, total) => onFileProgress(loaded, total)
              : undefined
          }
        });
        results.push(...result.results);
        failed += result.failed;
      } catch {
        failed++;
      }
      onFileComplete?.(i + 1, sourceKey);
    }

    return { results, failed, fileJobIds };
  }

  // ── Private: Conflict resolution ──────────────────────────────────────────

  /**
   * Check which destination keys already exist, returning ConflictEntry[]
   * with conflict=true for existing keys. An item pasted onto itself is never
   * a conflict: the server copies it to a unique name, and offering "replace"
   * would delete the source.
   */
  private async _checkDestinationConflicts(
    keys: string[],
    destPrefix: string,
    bucket: string,
    sourceBucket: string
  ): Promise<ConflictEntry[]> {
    const results: ConflictEntry[] = [];

    for (const key of keys) {
      const origName = keyToName(key);
      const destKey = this._destKey(key, destPrefix);
      let conflict = false;
      try {
        conflict =
          !(sourceBucket === bucket && destKey === key) &&
          (await this._destinationExists(bucket, destKey));
      } catch {
        // If the check fails, assume no conflict and proceed
      }
      results.push({
        id: crypto.randomUUID(),
        originalName: origName,
        conflict,
        resolution: conflict ? null : 'replace',
        customName: origName,
        renameState: 'idle',
        sourceKey: key
      });
    }

    return results;
  }

  /**
   * Delete conflicting destination files before copy/move to prevent
   * the server from auto-renaming them with " (2)" suffix.
   */
  private async _deleteConflictingDests(bucket: string, keysToDelete: string[]): Promise<void> {
    if (keysToDelete.length === 0) return;

    try {
      await this._api.delete({ bucket, keys: keysToDelete });
    } catch {
      // Best-effort - if deletion fails, the server may auto-rename
    }
  }

  /**
   * Execute a paste operation with conflict resolutions.
   * Renamed entries are first pasted with their original name, then renamed.
   */
  private async _executePasteWithConflicts(
    pending: PendingPasteOp,
    resolvedEntries: ConflictEntry[]
  ): Promise<void> {
    const bucket = pending.destBucket;
    const resolvedMap = new SvelteMap(
      resolvedEntries.map((e) => [e.sourceKey ?? e.originalName, e])
    );

    // Split keys by resolution
    const replaceKeys: string[] = [];
    const renameKeys: Array<{ sourceKey: string; newName: string }> = [];
    const keysToDelete: string[] = [];
    const renameErrors: RenameError[] = [];

    for (const key of pending.keys) {
      const entry = resolvedMap.get(key) ?? resolvedMap.get(keyToName(key));
      if (!entry || entry.resolution === 'skip') continue;
      if (entry.resolution === 'rename') {
        const newName = entry.customName.trim();
        if (!ConflictRenameNameSchema.safeParse(newName).success) {
          renameErrors.push({ name: keyToName(key), newName });
          continue;
        }
        renameKeys.push({ sourceKey: key, newName });
      } else if (entry.conflict) {
        const target = this._replaceTarget(key, pending.destPrefix, pending.sourceBucket, bucket);
        if (target === null) continue;
        keysToDelete.push(target);
      }
      replaceKeys.push(key);
    }

    if (replaceKeys.length === 0) {
      this._toastRenameErrors(renameErrors);
      return;
    }

    const opId = crypto.randomUUID();
    const abortController = new AbortController();
    const sourceNames = pending.keys.map((k) => keyToName(k));
    const isSinglePaste = pending.keys.length === 1;
    const pasteLabel = isSinglePaste
      ? `${m.storage_operation_paste_one({ count: 1 })}: ${sourceNames[0]}`
      : `${m.storage_operation_paste_other({ count: sourceNames.length })}: ${sourceNames[0]} + ${sourceNames.length - 1} more`;

    this._operations.startOp(
      opId,
      pasteLabel,
      'paste',
      replaceKeys.length + renameKeys.length,
      abortController,
      `${bucket}/${pending.destPrefix}`,
      sourceNames,
      pending.totalBytes
    );

    await this._deleteConflictingDests(bucket, keysToDelete);

    try {
      const { results, failed } = await this._performPasteSequential(
        replaceKeys,
        pending.sourceBucket,
        pending.destPrefix,
        pending.wasCut,
        abortController.signal,
        (index, key) => {
          this._operations.updateOpProgress(opId, index, 0, keyToName(key));
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (loaded, _total) => {
          const prevFiles =
            this._operations.operations.find((op) => op.id === opId)?.completedCount ?? 0;
          this._operations.updateOpProgress(opId, prevFiles, loaded, '');
        }
      );

      // Handle renamed items: rename the already-pasted destination item. A folder is
      // reported per child, so its pasted root is derived from the child results.
      const renamedRoots = new SvelteMap<string, string>();
      const renamedKeys = new SvelteMap<string, string>();
      for (const rename of renameKeys) {
        if (abortController.signal.aborted) break;
        const isFolder = rename.sourceKey.endsWith('/');
        const pastedRoot = this._pastedRoot(rename.sourceKey, results);
        const renameError = { name: keyToName(rename.sourceKey), newName: rename.newName };
        if (pastedRoot === null) {
          renameErrors.push(renameError);
          continue;
        }
        const newKey = pending.destPrefix + rename.newName + (isFolder ? '/' : '');
        try {
          const renamed = await this._api.move({
            bucket,
            sourceKeys: [pastedRoot],
            destinationPrefix: '',
            destinationKey: newKey
          });
          for (const r of renamed.results) renamedKeys.set(r.sourceKey, r.destKey);
          // On failure the item (or part of it) stays under its server-assigned name.
          if (renamed.failed > 0 || renamed.results.length === 0) {
            renameErrors.push({ ...renameError, partial: renamed.results.length > 0 });
            continue;
          }
          renamedRoots.set(pastedRoot, newKey);
          this._operations.updateOpProgress(
            opId,
            replaceKeys.length + renameKeys.indexOf(rename) + 1,
            0,
            rename.newName
          );
        } catch {
          renameErrors.push(renameError);
        }
      }

      await tick();
      const totalFailed = failed + renameErrors.length;
      this._operations.finishOp(opId, totalFailed > 0 ? 'error' : 'done');

      if (failed > 0) {
        addToast('warning', m.storage_action_paste_partial({ count: failed }));
      } else if (renameErrors.length === 0) {
        addToast('success', m.storage_action_paste_success({ count: replaceKeys.length }));
      }
      this._toastRenameErrors(renameErrors);
      if (pending.wasCut) {
        const movedKeys = new SvelteSet<string>();
        const movedSizes: Record<string, number> = {};
        for (const r of results) {
          const root = [...renamedRoots.keys()].find(
            (old) => r.destKey === old || (old.endsWith('/') && r.destKey.startsWith(old))
          );
          const destKey =
            root !== undefined
              ? renamedRoots.get(root)!
              : (renamedKeys.get(r.destKey) ?? r.destKey);
          movedKeys.add(destKey);
          if (!destKey.endsWith('/')) movedSizes[destKey] = pending.fileSizes[r.sourceKey] ?? 0;
        }
        this._pointClipboardAtMovedItems([...movedKeys], movedSizes, pending.sourcePrefix);
      }
      this._callbacks.refresh();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._operations.finishOp(opId, 'cancelled');
        return;
      }
      if (pageUnloading) {
        return;
      }
      this._operations.finishOp(opId, 'error');
      addToast('error', m.storage_action_paste_error());
    }
  }

  /**
   * Execute a move operation with conflict resolutions.
   * For "replace" entries: delete the conflicting destination first, then move.
   * For "rename" entries: move the source straight to its new name in the
   * destination. The server refuses (and nothing moves) if that name is taken.
   */
  private async _executeMoveWithConflicts(
    pending: PendingMoveOp,
    resolvedEntries: ConflictEntry[]
  ): Promise<void> {
    const bucket = pending.destBucket;
    const resolvedMap = new SvelteMap(
      resolvedEntries.map((e) => [e.sourceKey ?? e.originalName, e])
    );

    // Split keys by resolution. Renamed entries move with an explicit destination key.
    const replaceKeys: string[] = [];
    const renameTargets = new SvelteMap<string, string>();
    const keysToDelete: string[] = [];
    const renameErrors: RenameError[] = [];

    for (const key of pending.keys) {
      const entry = resolvedMap.get(key) ?? resolvedMap.get(keyToName(key));
      if (!entry || entry.resolution === 'skip') continue;
      if (entry.resolution === 'rename') {
        const newName = entry.customName.trim();
        if (ConflictRenameNameSchema.safeParse(newName).success) {
          renameTargets.set(key, pending.destPrefix + newName + (key.endsWith('/') ? '/' : ''));
        } else {
          renameErrors.push({ name: keyToName(key), newName });
        }
        continue;
      }
      if (entry.conflict) {
        const target = this._replaceTarget(
          key,
          pending.destPrefix,
          this._callbacks.getBucket(),
          bucket
        );
        if (target === null) continue;
        keysToDelete.push(target);
      }
      replaceKeys.push(key);
    }

    if (replaceKeys.length === 0 && renameTargets.size === 0) {
      this._toastRenameErrors(renameErrors);
      return;
    }

    const opId = crypto.randomUUID();
    const abortController = new AbortController();
    const sourceNames = pending.keys.map((k) => keyToName(k));
    const totalCount = replaceKeys.length + renameTargets.size;
    const isSingleMove = totalCount === 1;
    const moveLabel = isSingleMove
      ? `${m.storage_operation_move_one({ count: 1 })}: ${sourceNames[0]}`
      : `${m.storage_operation_move_other({ count: sourceNames.length })}: ${sourceNames[0]} + ${sourceNames.length - 1} more`;

    this._operations.startOp(
      opId,
      moveLabel,
      'move',
      totalCount,
      abortController,
      `${bucket}/${pending.destPrefix}`,
      sourceNames,
      pending.totalBytes
    );

    // Only delete conflicting destinations for "replace" entries
    await this._deleteConflictingDests(bucket, keysToDelete);

    try {
      const results: Array<{ sourceKey: string; destKey: string }> = [];
      let failed = 0;

      for (const key of replaceKeys) {
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        try {
          const result = await this._api.move({
            bucket,
            sourceBucket: this._callbacks.getBucket(),
            sourceKeys: [key],
            destinationPrefix: pending.destPrefix,
            progress: true,
            signal: abortController.signal,
            callbacks: {
              onComplete: (finalResults, finalFailed) => {
                if (finalResults.length > 0) {
                  results.length = 0;
                  results.push(...finalResults);
                }
                if (finalFailed.length > 0) {
                  failed = finalFailed.length;
                }
              }
            }
          });
          results.push(...result.results);
          failed += result.failed;
        } catch {
          failed++;
        }
        this._operations.updateOpProgress(opId, results.length, 0, keyToName(key));
      }

      // Renamed entries move in one request each, straight to their new name. The server
      // refuses the move if the name is taken; nothing else is moved in that case.
      for (const [key, destinationKey] of renameTargets) {
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        try {
          const result = await this._api.move({
            bucket,
            sourceBucket: this._callbacks.getBucket(),
            sourceKeys: [key],
            destinationPrefix: pending.destPrefix,
            destinationKey,
            signal: abortController.signal
          });
          results.push(...result.results);
          if (result.failed > 0 || result.results.length === 0) {
            renameErrors.push({
              name: keyToName(key),
              newName: keyToName(destinationKey),
              partial: result.results.length > 0
            });
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') throw err;
          renameErrors.push({ name: keyToName(key), newName: keyToName(destinationKey) });
        }
        this._operations.updateOpProgress(opId, results.length, 0, keyToName(key));
      }

      await tick();
      const totalFailed = renameErrors.length + failed;
      this._operations.finishOp(opId, totalFailed === 0 ? 'done' : 'error');

      if (results.length > 0) {
        if (renameErrors.length === 0) {
          addToast('success', m.storage_action_move_success({ count: results.length }));
        }
        const movedKeys = results.map((r) => r.sourceKey).filter((k) => !k.endsWith('/'));
        if (movedKeys.length > 0) {
          this._callbacks.removeFiles(bucket, movedKeys);
        }
        for (const r of results) {
          if (!r.destKey.endsWith('/')) {
            const item = pending.items.find((it) => it.key === r.sourceKey);
            if (item && item.size) {
              this._callbacks.recordFileVisit(bucket, r.destKey, item.size);
            }
          }
        }
      }
      if (failed > 0) {
        addToast('warning', m.storage_action_move_partial({ count: failed }));
      }
      this._toastRenameErrors(renameErrors);

      this._callbacks.clearSelection();
      if (pending.sourcePrefix !== null) {
        this._callbacks.invalidateSourceTabs(pending.sourcePrefix);
      }
      // Invalidate background tabs viewing the destination
      this._callbacks.invalidateSourceTabs(pending.destPrefix);
      this._callbacks.refresh();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._operations.finishOp(opId, 'cancelled');
        return;
      }
      if (pageUnloading) {
        return;
      }
      this._operations.finishOp(opId, 'error');
      addToast('error', m.storage_action_move_error());
    }
  }

  // ── Private: Helpers ───────────────────────────────────────────────────────

  /** Report each conflict rename that could not be applied, or was applied only in part. */
  private _toastRenameErrors(errors: RenameError[]): void {
    for (const { name, newName, partial } of errors) {
      addToast(
        'error',
        partial
          ? m.storage_conflict_rename_partial({ name, newName })
          : m.storage_conflict_rename_failed({ name, newName })
      );
    }
  }

  /**
   * Where a pasted item landed: its own result, or for a folder the root shared by its
   * children's results (a folder without a marker object has no result of its own).
   */
  private _pastedRoot(
    sourceKey: string,
    results: Array<{ sourceKey: string; destKey: string }>
  ): string | null {
    for (const r of results) {
      if (r.sourceKey === sourceKey) return r.destKey;
      if (!sourceKey.endsWith('/') || !r.sourceKey.startsWith(sourceKey)) continue;
      const suffix = r.sourceKey.slice(sourceKey.length);
      if (r.destKey.endsWith(suffix)) return r.destKey.slice(0, r.destKey.length - suffix.length);
    }
    return null;
  }

  /** Returns the longest common directory prefix of the given keys. */
  private _commonPrefix(keys: string[]): string {
    if (keys.length === 0) return '';
    const parts = keys[0].split('/');
    parts.pop(); // remove filename
    let prefix = parts.join('/') ? parts.join('/') + '/' : '';
    for (let i = 1; i < keys.length; i++) {
      while (prefix && !keys[i].startsWith(prefix)) {
        const idx = prefix.lastIndexOf('/', prefix.length - 2);
        prefix = idx >= 0 ? prefix.substring(0, idx + 1) : '';
      }
    }
    return prefix;
  }

  /** True when moving or pasting the key would write it over itself. */
  private _isAlreadyInDestination(key: string, destPrefix: string): boolean {
    const parentPrefix = key.endsWith('/')
      ? key.slice(0, -1).substring(0, key.slice(0, -1).lastIndexOf('/') + 1)
      : key.substring(0, key.lastIndexOf('/') + 1);
    return parentPrefix === destPrefix;
  }

  /**
   * True when the key would be pasted or moved onto itself. `otherBucket` is the
   * source bucket of a paste or the destination bucket of a move; the other side
   * is always the current bucket.
   */
  private _isSelfDestination(key: string, destPrefix: string, otherBucket: string): boolean {
    return (
      otherBucket === this._callbacks.getBucket() && this._isAlreadyInDestination(key, destPrefix)
    );
  }

  /** True when `key` is a folder and `destPrefix` lies inside it. */
  private _isFolderIntoItself(key: string, destPrefix: string): boolean {
    return key.endsWith('/') && destPrefix.startsWith(key);
  }

  /** Destination key for pasting `key` into `destPrefix`; folders keep their trailing slash. */
  private _destKey(key: string, destPrefix: string): string {
    return destPrefix + keyToName(key) + (key.endsWith('/') ? '/' : '');
  }

  /**
   * Destination key that "replace" deletes before pasting `sourceKey`, or null
   * when source and destination overlap: deleting it (recursively for folders)
   * would remove the source, or the destination lies inside a source folder.
   */
  private _replaceTarget(
    sourceKey: string,
    destPrefix: string,
    sourceBucket: string,
    destBucket: string
  ): string | null {
    const destKey = this._destKey(sourceKey, destPrefix);
    const destroysSource =
      sourceBucket === destBucket &&
      (sourceKey === destKey ||
        (destKey.endsWith('/') && sourceKey.startsWith(destKey)) ||
        (sourceKey.endsWith('/') && destKey.startsWith(sourceKey)));
    return destroysSource ? null : destKey;
  }

  /**
   * After a cut has been pasted, point the clipboard at the moved items so a
   * later paste copies them instead of re-moving (and replacing) the originals.
   */
  private _pointClipboardAtMovedItems(
    destKeys: string[],
    fileSizes: Record<string, number>,
    sourcePrefix: string
  ): void {
    if (destKeys.length === 0) return;
    // Invalidate source tabs so they refetch (items moved out)
    if (sourcePrefix) {
      this._callbacks.invalidateSourceTabs(sourcePrefix);
    }
    this.clipboard = {
      action: 'copy',
      keys: destKeys,
      sourceBucket: this._callbacks.getBucket(),
      sourcePrefix: this._callbacks.getPrefix(),
      fileSizes
    };
  }

  /** Check whether a file or folder (marker or any child) exists at `destKey`. */
  private async _destinationExists(bucket: string, destKey: string): Promise<boolean> {
    if (await this._api.checkObjectExists({ bucket, key: destKey })) return true;
    if (!destKey.endsWith('/')) return false;
    const page = await this._api.list({ bucket, prefix: destKey, pageSize: 1 });
    return page.objects.length > 0;
  }
}
