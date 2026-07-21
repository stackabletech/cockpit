import { SvelteMap } from 'svelte/reactivity';
import { tick } from 'svelte';
import * as m from '$lib/paraglide/messages.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import type { StoragePage, ClipboardData, ModalType } from '$lib/storage/types.js';
import type { ConflictEntry } from '$lib/components/storage/modals/shared/conflict-types.js';
import { keyToName } from '$lib/storage/utils.js';
import { ActionError, getActionErrorMessage } from './errors.js';
import { pageUnloading } from './operations.svelte.js';
import { storageMoveEnabled } from '$lib/client/feature-flags.js';
import { OperationsState } from './operations.svelte.js';
import type { StorageApi } from './api.js';

// ── Internal types ──────────────────────────────────────────────────────────

type PendingPasteOp = {
  type: 'paste';
  keys: string[];
  sourceBucket: string;
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
  items: Array<{ key: string; name: string; isDirectory: boolean; size?: number }>;
  sourcePrefix: string | null;
  totalBytes: number;
};

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

    const wasCut = pasteClipboard.action === 'cut';
    const pasteKeys = [...pasteClipboard.keys];

    // ── Check for name conflicts at destination ──────────────────────
    const conflictEntries = await this._checkDestinationConflicts(pasteKeys, destPrefix);
    const hasConflicts = conflictEntries.some((e) => e.conflict);
    if (hasConflicts) {
      // eslint-disable-next-line security/detect-object-injection
      const totalBytes = pasteKeys.reduce((sum, k) => sum + (pasteClipboard.fileSizes[k] ?? 0), 0);
      this._pendingConflictOp = {
        type: 'paste',
        keys: pasteKeys,
        sourceBucket: pasteClipboard.sourceBucket,
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
    // eslint-disable-next-line security/detect-object-injection
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
          // eslint-disable-next-line security/detect-object-injection
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
            // eslint-disable-next-line security/detect-object-injection
            prevBytes += fileSizes[pasteKeys[j]] ?? 0;
          }
          this._operations.updateOpProgress(
            opId,
            prevFiles,
            prevBytes + loaded,
            // eslint-disable-next-line security/detect-object-injection
            pasteSourceNames[prevFiles] ?? ''
          );
        },
        (index, jobId) => {
          // eslint-disable-next-line security/detect-object-injection
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
      // After a cut paste (move), update clipboard keys to the destination
      // keys so subsequent pastes copy from the newly created files.
      if (wasCut && results.length > 0) {
        const destKeys = results.map((r) => r.destKey);
        // Invalidate source tabs so they refetch (items moved out)
        if (pasteClipboard.sourcePrefix) {
          this._callbacks.invalidateSourceTabs(pasteClipboard.sourcePrefix);
        }
        this.clipboard = {
          action: 'copy',
          keys: destKeys,
          sourceBucket: bucket,
          sourcePrefix: this._callbacks.getPrefix(),
          fileSizes: newFileSizes
        };
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
        err instanceof ActionError ? getActionErrorMessage(err) : m.storage_action_paste_error()
      );
    }
  }

  // ── Move (drag-and-drop) ───────────────────────────────────────────────────

  /** Validate a drag-and-drop move and open the confirmation dialog. */
  performMove = (destPrefix: string, keys?: string[]): void => {
    if (!storageMoveEnabled) return;
    const objects = this._callbacks.getObjects();
    const moveKeys = keys ?? [...this._callbacks.getSelectedKeys()];
    if (moveKeys.length === 0) return;

    // Don't move items that are already directly inside destPrefix (no-op).
    const isAlreadyThere = (key: string): boolean => {
      if (key.endsWith('/')) return key === destPrefix;
      const parentPrefix = key.substring(0, key.lastIndexOf('/') + 1);
      return parentPrefix === destPrefix;
    };
    if (moveKeys.every(isAlreadyThere)) return;

    // Don't move a folder into itself
    for (const k of moveKeys) {
      if (k.endsWith('/') && destPrefix.startsWith(k)) return;
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
    this._pendingMove = { keys: moveKeys, destPrefix, items, sourcePrefix };
    this._pendingSourcePrefix = sourcePrefix;
    this._callbacks.openModal('confirm-move', { keys: moveKeys, destPrefix, items });
  };

  confirmMove = async (): Promise<void> => {
    if (!this._pendingMove) return;
    const { keys: moveKeys, destPrefix, items } = this._pendingMove;
    this._pendingMove = null;
    this._callbacks.closeModal();

    const bucket = this._callbacks.getBucket();

    // ── Check for name conflicts at destination ──────────────────────────
    const conflictEntries = await this._checkDestinationConflicts(moveKeys, destPrefix);
    const hasConflicts = conflictEntries.some((e) => e.conflict);
    if (hasConflicts) {
      const totalBytes = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
      this._pendingConflictOp = {
        type: 'move',
        keys: moveKeys,
        destPrefix,
        items,
        sourcePrefix: this._pendingSourcePrefix,
        totalBytes
      };
      this._callbacks.openModal('resolve-conflicts', {
        entries: conflictEntries,
        bucket,
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
      `${bucket}/${destPrefix}`,
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

        // eslint-disable-next-line security/detect-object-injection
        const sourceKey = moveKeys[i];
        const fileJobId = crypto.randomUUID();
        fileJobIds.push(fileJobId);
        this._operations.updateOpJobIds(opId, [...fileJobIds]);

        try {
          const result = await this._api.move({
            bucket,
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
              this._callbacks.recordFileVisit(bucket, r.destKey, item.size);
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
            // eslint-disable-next-line security/detect-object-injection
            if (this.clipboard.fileSizes[k] !== undefined) {
              // eslint-disable-next-line security/detect-object-injection
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
    _sourceBucket: string,
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
        sourceKeys: keys,
        destinationPrefix: destPrefix,
        signal
      });
    }
    return this._api.copy({
      bucket: this._callbacks.getBucket(),
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
    _sourceBucket: string,
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

      // eslint-disable-next-line security/detect-object-injection
      const sourceKey = keys[i];
      const fileJobId = crypto.randomUUID();
      fileJobIds.push(fileJobId);
      onFileJobId?.(i, fileJobId);

      try {
        const result = await moveFn({
          bucket: this._callbacks.getBucket(),
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
   * with conflict=true for existing keys.
   */
  private async _checkDestinationConflicts(
    keys: string[],
    destPrefix: string
  ): Promise<ConflictEntry[]> {
    const bucket = this._callbacks.getBucket();
    const results: ConflictEntry[] = [];

    for (const key of keys) {
      const origName = keyToName(key);
      const destKey = destPrefix + origName;
      let conflict = false;
      try {
        conflict = await this._api.checkObjectExists({ bucket, key: destKey });
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
  private async _deleteConflictingDests(
    destPrefix: string,
    resolvedEntries: ConflictEntry[]
  ): Promise<void> {
    const bucket = this._callbacks.getBucket();
    const keysToDelete: string[] = [];
    for (const entry of resolvedEntries) {
      if (entry.resolution === 'skip' || entry.resolution === 'rename') continue;
      if (entry.conflict) {
        keysToDelete.push(destPrefix + entry.originalName);
      }
    }

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
    const bucket = this._callbacks.getBucket();
    const resolvedMap = new SvelteMap(
      resolvedEntries.map((e) => [e.sourceKey ?? e.originalName, e])
    );

    // Split keys by resolution
    const replaceKeys: string[] = [];
    const renameKeys: Array<{ sourceKey: string; newName: string }> = [];

    for (const key of pending.keys) {
      const entry = resolvedMap.get(key) ?? resolvedMap.get(keyToName(key));
      if (!entry || entry.resolution === 'skip') continue;
      if (entry.resolution === 'rename') {
        renameKeys.push({ sourceKey: key, newName: entry.customName.trim() });
      }
      replaceKeys.push(key);
    }

    if (replaceKeys.length === 0 && renameKeys.length === 0) return;

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

    await this._deleteConflictingDests(pending.destPrefix, resolvedEntries);

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

      // Handle renamed files: rename the already-pasted destination file
      const destKeyMap = new SvelteMap(results.map((r) => [r.sourceKey, r.destKey]));
      let renameFailed = 0;
      for (const rename of renameKeys) {
        if (abortController.signal.aborted) break;
        const destKey = destKeyMap.get(rename.sourceKey);
        if (!destKey) {
          renameFailed++;
          continue;
        }
        const newKey = pending.destPrefix + rename.newName;
        try {
          await this._api.rename({ bucket, key: destKey, newKey });
          this._operations.updateOpProgress(
            opId,
            replaceKeys.length + renameKeys.indexOf(rename) + 1,
            0,
            rename.newName
          );
        } catch {
          renameFailed++;
        }
      }

      await tick();
      const totalFailed = failed + renameFailed;
      this._operations.finishOp(opId, totalFailed > 0 ? 'error' : 'done');

      if (totalFailed > 0) {
        addToast('warning', m.storage_action_paste_partial({ count: totalFailed }));
      } else {
        addToast(
          'success',
          m.storage_action_paste_success({ count: replaceKeys.length + renameKeys.length })
        );
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
   * For "rename" entries: rename the source at its current location first,
   * then move the renamed source to the destination — the file never appears
   * at the original name in the destination.
   */
  private async _executeMoveWithConflicts(
    pending: PendingMoveOp,
    resolvedEntries: ConflictEntry[]
  ): Promise<void> {
    const bucket = this._callbacks.getBucket();
    const resolvedMap = new SvelteMap(
      resolvedEntries.map((e) => [e.sourceKey ?? e.originalName, e])
    );

    // Split keys by resolution — rename entries are NOT added to replaceKeys here.
    // They will be renamed at source first, then added to replaceKeys before the move loop.
    const replaceKeys: string[] = [];
    const renameKeys: Array<{ sourceKey: string; newName: string }> = [];

    for (const key of pending.keys) {
      const entry = resolvedMap.get(key) ?? resolvedMap.get(keyToName(key));
      if (!entry || entry.resolution === 'skip') continue;
      if (entry.resolution === 'rename') {
        renameKeys.push({ sourceKey: key, newName: entry.customName.trim() });
      } else {
        replaceKeys.push(key);
      }
    }

    if (replaceKeys.length === 0 && renameKeys.length === 0) return;

    const opId = crypto.randomUUID();
    const abortController = new AbortController();
    const sourceNames = pending.keys.map((k) => keyToName(k));
    const totalCount = replaceKeys.length + renameKeys.length;
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
    await this._deleteConflictingDests(pending.destPrefix, resolvedEntries);

    try {
      const results: Array<{ sourceKey: string; destKey: string }> = [];
      let renameFailed = 0;
      let failed = 0;

      // ── Pre-processing: rename rename entries at source before moving ─────
      for (const rename of renameKeys) {
        if (abortController.signal.aborted) break;

        const parts = rename.sourceKey.split('/');
        parts.pop();
        const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
        const renamedSourceKey =
          parentPrefix + rename.newName + (rename.sourceKey.endsWith('/') ? '/' : '');

        try {
          await this._api.rename({
            bucket,
            key: rename.sourceKey,
            newKey: renamedSourceKey
          });
          replaceKeys.push(renamedSourceKey);
        } catch {
          renameFailed++;
        }
      }

      failed = renameFailed;

      // ── Move all entries ────────────────────────────────────────────────────

      for (const key of replaceKeys) {
        if (abortController.signal.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }

        try {
          const result = await this._api.move({
            bucket,
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

      await tick();
      const totalFailed = renameFailed + failed;
      this._operations.finishOp(opId, totalFailed === 0 ? 'done' : 'error');

      if (results.length > 0) {
        addToast('success', m.storage_action_move_success({ count: results.length }));
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
      if (totalFailed > 0) {
        addToast('warning', m.storage_action_move_partial({ count: totalFailed }));
      }

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

  /** Returns the longest common directory prefix of the given keys. */
  private _commonPrefix(keys: string[]): string {
    if (keys.length === 0) return '';
    const parts = keys[0].split('/');
    parts.pop(); // remove filename
    let prefix = parts.join('/') ? parts.join('/') + '/' : '';
    for (let i = 1; i < keys.length; i++) {
      // eslint-disable-next-line security/detect-object-injection
      while (prefix && !keys[i].startsWith(prefix)) {
        const idx = prefix.lastIndexOf('/', prefix.length - 2);
        prefix = idx >= 0 ? prefix.substring(0, idx + 1) : '';
      }
    }
    return prefix;
  }
}
