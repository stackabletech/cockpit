import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import * as m from '$lib/paraglide/messages.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import type { StoragePage, ClipboardData, ModalType } from '$lib/storage/types.js';
import type { ConflictEntry } from '$lib/components/storage/modals/shared/conflict-types.js';
import { keyToName, parentPrefix } from '$lib/storage/utils.js';
import { StorageError, getActionErrorMessage } from './errors.js';
import { pageUnloading } from './operations.svelte.js';
import { storageMoveEnabled } from '$lib/client/feature-flags.js';
import { OperationsState } from './operations.svelte.js';
import type { StorageApi } from './api.js';
import { MAX_TRANSFER_ITEMS, type PlanItem, type TransferItemRequest } from './transfer-types.js';
import { refusalMessage, runTransfer, toastTransferResults, type ItemOutcome } from './transfer.js';

// ── Internal types ──────────────────────────────────────────────────────────

/** Where a copy or move goes, fixed when the user acts (never re-read later). */
interface TransferTarget {
  op: 'copy' | 'move';
  sourceBucket: string;
  destBucket: string;
  destPrefix: string;
  keys: string[];
  /** File sizes by key, for recent-file tracking. */
  fileSizes: Record<string, number>;
  /** The clipboard a cut paste came from; it is updated after the move. */
  clipboard: ClipboardData | null;
  /** The user's action, for the wording of operations and toasts. */
  action: 'paste' | 'move';
}

/** A transfer waiting for the conflict dialog. */
interface PendingTransfer extends TransferTarget {
  /** Items sent without asking: no conflict, or a copy onto itself (kept as both). */
  ready: TransferItemRequest[];
}

/** A drag-and-drop move waiting for confirmation. */
interface PendingMove extends TransferTarget {
  items: Array<{ key: string; name: string; isDirectory: boolean; size?: number }>;
}

/** Where dragged items come from, as carried in the drag data. */
export interface DragSource {
  connectionId: string | null;
  bucket: string;
}

// ── Callbacks interface ──────────────────────────────────────────────────────

export interface ClipboardStateCallbacks {
  getBucket: () => string;
  getPrefix: () => string;
  getConnectionId: () => string | null;
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
  /** Current clipboard content (null when empty). */
  clipboard = $state<ClipboardData | null>(null);

  private _pendingTransfer: PendingTransfer | null = null;
  /**
   * A paste or drag-move is being planned or run. A second one would race it,
   * e.g. move the same items twice, so it is refused until the first ends.
   */
  private _transfersRunning = 0;

  private get _transferRunning(): boolean {
    return this._transfersRunning > 0;
  }
  private _pendingMove: PendingMove | null = null;

  private _api: StorageApi;
  private _operations: OperationsState;
  private _callbacks: ClipboardStateCallbacks;

  constructor(api: StorageApi, operations: OperationsState, callbacks: ClipboardStateCallbacks) {
    this._api = api;
    this._operations = operations;
    this._callbacks = callbacks;
  }

  /** Whether the clipboard can be pasted in the active connection. */
  get canPaste(): boolean {
    return (
      this.clipboard !== null &&
      this.clipboard.keys.length > 0 &&
      this.clipboard.connectionId === this._callbacks.getConnectionId()
    );
  }

  // ── Cut / Copy ─────────────────────────────────────────────────────────────

  /** Returns true when `key` is in the clipboard with action='cut' and the bucket matches. */
  isCutKey(key: string, bucket: string): boolean {
    return (
      this.clipboard?.action === 'cut' &&
      this.clipboard.sourceBucket === bucket &&
      this.clipboard.keys.includes(key)
    );
  }

  /** Set clipboard with cut action. Caller should check storageCutCopyEnabled before calling. */
  cut(selectedKeys: string[], objects: StoragePage, bucket: string, prefix: string): void {
    if (selectedKeys.length === 0) return;
    this.clipboard = this._clipboardFor('cut', selectedKeys, objects, bucket, prefix);
    addToast('info', m.storage_action_cut_success({ count: selectedKeys.length }));
  }

  /** Set clipboard with copy action. Caller should check storageCutCopyEnabled before calling. */
  copy(selectedKeys: string[], objects: StoragePage, bucket: string, prefix: string): void {
    if (selectedKeys.length === 0) return;
    this.clipboard = this._clipboardFor('copy', selectedKeys, objects, bucket, prefix);
    addToast('info', m.storage_action_copy_success({ count: selectedKeys.length }));
  }

  // ── Paste ──────────────────────────────────────────────────────────────────

  /**
   * Paste the clipboard into `destPrefix` of the current bucket. Caller should
   * check storagePasteEnabled and that the clipboard is non-empty first.
   */
  async paste(destPrefix: string): Promise<void> {
    const clipboard = this.clipboard;
    if (!clipboard) return;
    if (clipboard.connectionId !== this._callbacks.getConnectionId()) {
      addToast('warning', m.storage_transfer_other_connection());
      return;
    }
    if (this._transferRunning) {
      addToast('info', m.storage_transfer_running());
      return;
    }
    await this._whileTransferring(() =>
      this._plan({
        op: clipboard.action === 'cut' ? 'move' : 'copy',
        sourceBucket: clipboard.sourceBucket,
        destBucket: this._callbacks.getBucket(),
        destPrefix,
        keys: clipboard.keys,
        fileSizes: clipboard.fileSizes,
        clipboard: clipboard.action === 'cut' ? clipboard : null,
        action: 'paste'
      })
    );
  }

  private async _whileTransferring(run: () => Promise<void>): Promise<void> {
    this._transfersRunning++;
    try {
      await run();
    } finally {
      this._transfersRunning--;
    }
  }

  // ── Move (drag-and-drop) ───────────────────────────────────────────────────

  /**
   * Validate a drag-and-drop move and open the confirmation dialog. `source` is
   * where the dragged items come from; it defaults to the current bucket.
   */
  performMove = (
    destPrefix: string,
    keys?: string[],
    destBucket = this._callbacks.getBucket(),
    source: DragSource = {
      connectionId: this._callbacks.getConnectionId(),
      bucket: this._callbacks.getBucket()
    }
  ): void => {
    if (!storageMoveEnabled) return;
    if (source.connectionId !== this._callbacks.getConnectionId()) {
      addToast('warning', m.storage_transfer_other_connection());
      return;
    }
    if (this._transferRunning) {
      addToast('info', m.storage_transfer_running());
      return;
    }
    const moveKeys = keys ?? [...this._callbacks.getSelectedKeys()];
    // A drop into the folder the items already live in does nothing.
    if (
      moveKeys.length === 0 ||
      (source.bucket === destBucket && moveKeys.every((key) => parentPrefix(key) === destPrefix))
    ) {
      return;
    }

    const objects = this._callbacks.getObjects();
    const fileSizes: Record<string, number> = {};
    const items = moveKeys.map((key) => {
      const obj = objects.objects.find((o) => o.key === key);
      const size = obj && !obj.isDirectory ? obj.size : undefined;
      if (size !== undefined) fileSizes[key] = size;
      return { key, name: keyToName(key), isDirectory: key.endsWith('/'), size };
    });

    this._pendingMove = {
      op: 'move',
      sourceBucket: source.bucket,
      destBucket,
      destPrefix,
      keys: moveKeys,
      fileSizes,
      clipboard: null,
      action: 'move',
      items
    };
    this._callbacks.openModal('confirm-move', { keys: moveKeys, destPrefix, items });
  };

  confirmMove = async (): Promise<void> => {
    const pending = this._pendingMove;
    if (!pending) return;
    this._pendingMove = null;
    this._callbacks.closeModal();
    if (this._transferRunning) {
      addToast('info', m.storage_transfer_running());
      return;
    }
    await this._whileTransferring(() => this._plan(pending));
  };

  cancelMove = (): void => {
    this._pendingMove = null;
    this._callbacks.closeModal();
  };

  // ── Conflict resolution ────────────────────────────────────────────────────

  confirmConflictResolution = async (entries: ConflictEntry[]): Promise<void> => {
    const pending = this._pendingTransfer;
    if (!pending) return;
    // Another transfer started while the dialog was open: keep the dialog and its
    // choices, so the user can confirm again once that one has finished.
    if (this._transferRunning) {
      addToast('info', m.storage_transfer_running());
      return;
    }
    this._pendingTransfer = null;
    this._callbacks.closeModal();

    const chosen: TransferItemRequest[] = [];
    for (const entry of entries) {
      if (!entry.sourceKey || !entry.conflict || entry.resolution === null) continue;
      if (entry.resolution === 'skip') continue;
      if (entry.resolution === 'rename') {
        chosen.push({
          sourceKey: entry.sourceKey,
          policy: 'rename',
          name: entry.customName.trim()
        });
      } else {
        chosen.push({ sourceKey: entry.sourceKey, policy: entry.resolution });
      }
    }
    // Keep the request in the order of the selection.
    const order = new SvelteMap(pending.keys.map((key, index) => [key, index]));
    const items = [...pending.ready, ...chosen].sort(
      (a, b) => order.get(a.sourceKey)! - order.get(b.sourceKey)!
    );
    if (items.length === 0) return;
    await this._whileTransferring(() => this._execute(pending, items));
  };

  /**
   * Whether the name chosen for a conflict entry is free at the destination,
   * planned by the server under the rules the transfer itself applies.
   * Throws when the check cannot be made, so the dialog lets the user retry.
   */
  checkConflictRename = async (entry: ConflictEntry): Promise<boolean> => {
    const pending = this._pendingTransfer;
    if (!pending || !entry.sourceKey) throw new Error('No transfer waiting for this entry');
    // Items without a conflict go in the same request under their own names; the
    // one-item plan below cannot see them, so a rename onto one is caught here.
    const name = entry.customName.trim();
    const suffix = entry.sourceKey.endsWith('/') ? '/' : '';
    const takenByReady = pending.ready.some(
      (item) =>
        item.policy === undefined &&
        keyToName(item.sourceKey) + (item.sourceKey.endsWith('/') ? '/' : '') === name + suffix
    );
    if (takenByReady) return false;
    let plan: PlanItem[];
    try {
      plan = await this._api.planTransfer({
        op: pending.op,
        source: { bucket: pending.sourceBucket, keys: [entry.sourceKey] },
        dest: { bucket: pending.destBucket, prefix: pending.destPrefix },
        names: { [entry.sourceKey]: name }
      });
    } catch (err) {
      this._toastRequestError(pending.action, err);
      throw err;
    }
    const item = plan[0];
    return !!item && !item.refused && item.conflict === 'none';
  };

  cancelConflictResolution = (): void => {
    this._pendingTransfer = null;
    this._callbacks.closeModal();
  };

  // ── Clipboard cleanup ──────────────────────────────────────────────────────

  /** Remove deleted keys from the clipboard after a delete operation. */
  removeDeletedKeys(bucket: string, keys: string[]): void {
    if (!this.clipboard || this.clipboard.sourceBucket !== bucket) return;
    const remainingKeys = this.clipboard.keys.filter((k) => !keys.includes(k));
    if (remainingKeys.length === this.clipboard.keys.length) return;
    this.clipboard =
      remainingKeys.length === 0 ? null : this._withKeys(this.clipboard, remainingKeys);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _clipboardFor(
    action: ClipboardData['action'],
    keys: string[],
    objects: StoragePage,
    bucket: string,
    prefix: string
  ): ClipboardData {
    const fileSizes: Record<string, number> = {};
    for (const obj of objects.objects) {
      if (keys.includes(obj.key) && !obj.isDirectory) fileSizes[obj.key] = obj.size;
    }
    return {
      action,
      keys,
      connectionId: this._callbacks.getConnectionId(),
      sourceBucket: bucket,
      sourcePrefix: prefix,
      fileSizes
    };
  }

  private _withKeys(clipboard: ClipboardData, keys: string[]): ClipboardData {
    const fileSizes: Record<string, number> = {};
    for (const key of keys) {
      if (clipboard.fileSizes[key] !== undefined) fileSizes[key] = clipboard.fileSizes[key];
    }
    return { ...clipboard, keys, fileSizes };
  }

  /**
   * Ask the server what the transfer would do, then either run it or let the
   * user resolve conflicts first. A copy onto itself is kept as both without
   * asking, so Ctrl+C/Ctrl+V gives `file (1).txt`.
   */
  private async _plan(target: TransferTarget): Promise<void> {
    if (target.keys.length > MAX_TRANSFER_ITEMS) {
      addToast('error', m.storage_transfer_too_many({ max: MAX_TRANSFER_ITEMS }));
      return;
    }

    let plan: PlanItem[];
    try {
      plan = await this._api.planTransfer({
        op: target.op,
        source: { bucket: target.sourceBucket, keys: target.keys },
        dest: { bucket: target.destBucket, prefix: target.destPrefix }
      });
    } catch (err) {
      this._toastRequestError(target.action, err);
      return;
    }

    const ready: TransferItemRequest[] = [];
    const conflicts: PlanItem[] = [];
    const refused: PlanItem[] = [];
    for (const item of plan) {
      if (item.refused) refused.push(item);
      else if (item.selfConflict) ready.push({ sourceKey: item.sourceKey, policy: 'keepBoth' });
      else if (item.conflict !== 'none') conflicts.push(item);
      else ready.push({ sourceKey: item.sourceKey });
    }

    if (conflicts.length === 0 && refused.length === 0) {
      await this._execute(target, ready);
      return;
    }

    this._pendingTransfer = { ...target, ready };
    const entries: ConflictEntry[] = conflicts.map((item) => ({
      id: item.sourceKey,
      originalName: keyToName(item.sourceKey),
      conflict: true,
      resolution: null,
      customName: item.suggestedName ?? keyToName(item.sourceKey),
      renameState: 'idle',
      sourceKey: item.sourceKey,
      kind: item.kind,
      allowKeepBoth: true,
      destPrefix: target.destPrefix
    }));
    this._callbacks.openModal('resolve-conflicts', {
      entries,
      refused: refused.map((item) => ({
        name: keyToName(item.sourceKey),
        reason: refusalMessage(item.refused!)
      })),
      closeOnly: conflicts.length === 0 && ready.length === 0,
      confirmLabel: target.action === 'paste' ? m.storage_action_paste() : m.storage_action_move()
    });
  }

  private async _execute(target: TransferTarget, items: TransferItemRequest[]): Promise<void> {
    if (items.length === 0) return;
    const names = items.map((item) => keyToName(item.sourceKey));
    const label =
      target.action === 'paste'
        ? names.length === 1
          ? `${m.storage_operation_paste_one({ count: 1 })}: ${names[0]}`
          : `${m.storage_operation_paste_other({ count: names.length })}: ${names[0]} ${m.storage_transfer_more({ count: names.length - 1 })}`
        : names.length === 1
          ? `${m.storage_operation_move_one({ count: 1 })}: ${names[0]}`
          : `${m.storage_operation_move_other({ count: names.length })}: ${names[0]} ${m.storage_transfer_more({ count: names.length - 1 })}`;

    let results: ItemOutcome[];
    try {
      results = await runTransfer({
        api: this._api,
        operations: this._operations,
        body: {
          op: target.op,
          source: { bucket: target.sourceBucket },
          dest: { bucket: target.destBucket, prefix: target.destPrefix },
          items
        },
        label,
        type: target.action,
        destPath: `${target.destBucket}/${target.destPrefix}`
      });
    } catch (err) {
      if (!pageUnloading) this._toastRequestError(target.action, err);
      return;
    }

    toastTransferResults(target.action, results);
    this._recordFiles(target, results);
    if (target.clipboard) this._updateClipboardAfterCut(target, results);
    if (target.op === 'move' && !target.clipboard) this._callbacks.clearSelection();
    this._refreshAffected(target, results);
  }

  private _toastRequestError(action: 'paste' | 'move', err: unknown): void {
    addToast(
      'error',
      err instanceof StorageError
        ? getActionErrorMessage(err)
        : action === 'paste'
          ? m.storage_action_paste_error()
          : m.storage_action_move_error()
    );
  }

  /** Keep recent files in step: moved files leave their old key, copies are visited. */
  private _recordFiles(target: TransferTarget, results: ItemOutcome[]): void {
    const landed = results.filter(
      (item) =>
        (item.status === 'done' || item.status === 'partial') &&
        item.destRoot &&
        !item.sourceKey.endsWith('/')
    );
    if (target.op === 'move') {
      const moved = landed.filter((item) => item.status === 'done').map((item) => item.sourceKey);
      if (moved.length > 0) this._callbacks.removeFiles(target.sourceBucket, moved);
    }
    for (const item of landed) {
      const size = target.fileSizes[item.sourceKey];
      if (size) this._callbacks.recordFileVisit(target.destBucket, item.destRoot!, size);
    }
  }

  /**
   * After a cut is pasted: if every item moved, the clipboard copies them from
   * their new location, so a second paste cannot move them again. Otherwise the
   * moved items leave the clipboard and the rest stay cut, so another paste
   * retries exactly those. A clipboard replaced in the meantime is left alone.
   */
  private _updateClipboardAfterCut(target: TransferTarget, results: ItemOutcome[]): void {
    const clipboard = target.clipboard!;
    if (this.clipboard !== clipboard) return;
    // Moved means originals were deleted: the destination is then the only complete copy.
    // A `partial` whose copies failed kept every original and stays cut, so a paste retries it.
    const moved = results.filter(
      (item) =>
        (item.status === 'done' || item.status === 'partial') &&
        item.destRoot &&
        item.deletedOriginals > 0
    );
    if (moved.length === 0) return;
    const movedKeys = new SvelteSet(moved.map((item) => item.sourceKey));
    const unmoved = clipboard.keys.filter((key) => !movedKeys.has(key));

    if (unmoved.length > 0) {
      this.clipboard = this._withKeys(clipboard, unmoved);
      return;
    }
    const fileSizes: Record<string, number> = {};
    for (const item of moved) {
      const size = clipboard.fileSizes[item.sourceKey];
      if (size !== undefined) fileSizes[item.destRoot!] = size;
    }
    this.clipboard = {
      action: 'copy',
      keys: moved.map((item) => item.destRoot!),
      connectionId: clipboard.connectionId,
      sourceBucket: target.destBucket,
      sourcePrefix: target.destPrefix,
      fileSizes
    };
  }

  /** Refresh the current view only if it shows an affected folder; mark other tabs stale. */
  private _refreshAffected(target: TransferTarget, results: ItemOutcome[]): void {
    const affected = new SvelteSet<string>([`${target.destBucket}\n${target.destPrefix}`]);
    if (target.op === 'move') {
      for (const item of results) {
        if (item.deletedOriginals > 0) {
          affected.add(`${target.sourceBucket}\n${parentPrefix(item.sourceKey)}`);
        }
      }
    }
    const prefixes = new SvelteSet([...affected].map((entry) => entry.split('\n')[1]));
    for (const prefix of prefixes) this._callbacks.invalidateSourceTabs(prefix);
    if (affected.has(`${this._callbacks.getBucket()}\n${this._callbacks.getPrefix()}`)) {
      this._callbacks.refresh();
    }
  }
}
