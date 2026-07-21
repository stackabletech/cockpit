import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { tick } from 'svelte';
import { browser } from '$app/environment';
import { invalidateAll } from '$app/navigation';
import * as m from '$lib/paraglide/messages.js';
import type { StoragePage, StorageObject } from '$lib/storage/types.js';
import type {
  ActiveModal,
  ModalType,
  ModalPayloads,
  ContextMenuState,
  NavigateFn,
  ActionName,
  ClipboardState,
  StorageOperation
} from '$lib/storage/types.js';
import { ARCHIVE_EXTENSIONS } from '$lib/storage/types.js';
import { initPageSize, type PageSize } from '$lib/types/pagination.js';
import {
  defaultPageSize,
  storageCutCopyEnabled,
  storagePasteEnabled,
  storageRenameEnabled,
  storageMoveEnabled
} from '$lib/client/feature-flags.js';
import { downloadObject } from '$lib/storage/download.js';
import type { ConflictEntry } from '$lib/components/storage/modals/shared/conflict-types.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { ActionError, StorageError, getActionErrorMessage } from './errors.js';
import { BookmarksState } from './bookmarks.svelte.js';
import { connectionStore } from '$lib/storage/connection-store.svelte.js';
import { keyToName } from '$lib/storage/utils.js';
import type { StorageApi } from './api.js';
import { createFetchStorageApi } from './api.js';

// Set to true when the page starts unloading (reload, tab close, navigate away).
// Used to suppress misleading error toasts for in-flight operations that the
// browser cancelled — the server-side copies continue regardless.
let pageUnloading = false;
if (browser) {
  window.addEventListener('beforeunload', () => {
    pageUnloading = true;
  });
}

// ── Operations history localStorage helpers ───────────────────────────────────

const OPERATIONS_HISTORY_KEY = 'storage_operations_history';
const MAX_HISTORY_ENTRIES = 30; // magic number: keep a reasonable number of past operations in localStorage

function loadPersistedOperations(): StorageOperation[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(OPERATIONS_HISTORY_KEY);
    if (!raw) return [];
    const ops = JSON.parse(raw) as StorageOperation[];
    if (!Array.isArray(ops)) return [];
    // Any operation that was still running when the page was last closed is now interrupted.
    return ops.map((op) =>
      op.status === 'running'
        ? { ...op, status: 'interrupted' as const, completedAt: op.completedAt ?? Date.now() }
        : op
    );
  } catch {
    return [];
  }
}

function saveOperationsToStorage(ops: StorageOperation[]): void {
  if (!browser) return;
  try {
    // Persist only non-running entries (capped); running ones are saved on _startOp.
    const history = ops.filter((op) => op.status !== 'running').slice(-MAX_HISTORY_ENTRIES);
    // Merge with any running ops so they appear as interrupted after a refresh.
    const running = ops.filter((op) => op.status === 'running');
    const toSave = [...running, ...history].slice(-MAX_HISTORY_ENTRIES);
    localStorage.setItem(OPERATIONS_HISTORY_KEY, JSON.stringify(toSave));
  } catch {
    // Best effort.
  }
}

export class StorageState {
  // ── Core data (synced from server load) ──
  bucket = $state('');
  prefix = $state('');
  objects = $state.raw<StoragePage>({
    objects: [],
    hasNextPage: false,
    currentPage: 1,
    pageSize: defaultPageSize
  });
  buckets = $state<string[]>([]);
  connected = $state(false);

  // ── Derived views ──
  folders = $derived(this.objects.objects.filter((o: StorageObject) => o.isDirectory));
  files = $derived(this.objects.objects.filter((o: StorageObject) => !o.isDirectory));
  totalItemCount = $derived(this.folders.length + this.files.length);

  // ── Selection ──
  selectedKeys = $state(new SvelteSet<string>());
  selectionMode = $state(false);

  allSelected = $derived(this.totalItemCount > 0 && this.selectedKeys.size >= this.totalItemCount);
  someSelected = $derived(
    this.selectedKeys.size > 0 && this.selectedKeys.size < this.totalItemCount
  );
  showCheckboxes = $derived(this.selectionMode || this.selectedKeys.size > 0);
  selectedFiles = $derived(this.files.filter((f: StorageObject) => this.selectedKeys.has(f.key)));
  selectedFolders = $derived(
    this.folders.filter((f: StorageObject) => this.selectedKeys.has(f.key))
  );

  // ── Modal ──
  activeModal = $state<ActiveModal | null>(null);

  // ── Context menu ──
  contextMenu = $state<ContextMenuState | null>(null);

  get ctxFileObj(): StorageObject | null {
    if (!this.contextMenu?.key) return null;
    return this.files.find((f: StorageObject) => f.key === this.contextMenu!.key) ?? null;
  }
  get ctxIsFile(): boolean {
    return this.ctxFileObj !== null;
  }
  get canPin(): boolean {
    return this.contextMenu !== null && !!this.contextMenu.key && !this.ctxIsFile;
  }
  get ctxIsPinned(): boolean {
    if (!this.contextMenu?.key || this.ctxIsFile) return false;
    return this.bookmarks.isPinned(this.bucket, this.contextMenu.key);
  }

  // ── Loading ──
  loading = $state(false);
  deleting = $state(false);

  // ── Rename inline ──
  renameLoading = $state(false);
  renameError = $state<string | null>(null);

  // ── Connection identity ──
  connectionId = $state<string | null>(null);

  // ── Pagination ──
  prevTokens = $state<(string | null)[]>([]);
  pageSize = $state<PageSize>(initPageSize('storage_page_size'));
  currentPage = $derived(this.prevTokens.length + 1);

  // ── Archive navigation ──
  archiveKey = $state<string | null>(null);
  archivePrefix = $state('');
  archiveNestedPath = $state<string | null>(null);
  previousS3Prefix = $state('');
  archiveLoading = $state(false);
  archiveTooLarge = $state(false);
  isInArchive = $derived(this.archiveKey !== null);

  // ── Composed sub-state ──
  bookmarks: BookmarksState;

  // ── Clipboard (cut / copy) ──
  clipboard = $state<ClipboardState | null>(null);

  // ── Pending conflict resolution (paste / move) ──
  _pendingConflictOp = $state<
    | {
        type: 'paste';
        keys: string[];
        sourceBucket: string;
        destPrefix: string;
        wasCut: boolean;
        fileSizes: Record<string, number>;
        sourcePrefix: string;
        totalBytes: number;
      }
    | {
        type: 'move';
        keys: string[];
        destPrefix: string;
        items: Array<{ key: string; name: string; isDirectory: boolean; size?: number }>;
        sourcePrefix: string | null;
        totalBytes: number;
      }
    | null
  >(null);

  // ── Operations (paste / move / rename progress) ──
  operations = $state<StorageOperation[]>([]);
  hasRunningOps = $derived(this.operations.some((op) => op.status === 'running'));
  /** AbortControllers keyed by operation ID, used to cancel in-flight requests. */
  private _abortControllers = new SvelteMap<string, AbortController>();

  /** True when `key` is in the clipboard with action='cut' and the bucket matches. */
  isCutKey(key: string): boolean {
    return (
      this.clipboard?.action === 'cut' &&
      this.clipboard.sourceBucket === this.bucket &&
      this.clipboard.keys.includes(key)
    );
  }

  // ── Navigation handler (injected by page component) ──
  private _onNavigate: NavigateFn = () => {};
  // ── Refresh handler (injected by page component) ──
  // Navigates to the current bucket/prefix using replaceState so that a
  // refresh does not add an extra browser history entry. Falls back to
  // invalidateAll when no handler has been set (e.g. in tests).
  private _onRefreshNavigate: (() => void) | null = null;
  // ── Tabs invalidation callback (injected by FileExplorer) ──
  // Called after file operations to mark source tabs as stale so they refetch
  // when the user switches back to them.
  private _onInvalidateSourceTabs: ((prefix: string) => void) | null = null;
  private _pendingSourcePrefix: string | null = null;

  // ────────────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────────────

  private _api: StorageApi;

  constructor(options?: {
    connected?: boolean;
    buckets?: string[];
    connectionId?: string | null;
    api?: StorageApi;
  }) {
    if (options?.connected !== undefined) this.connected = options.connected;
    if (options?.buckets) this.buckets = options.buckets;
    if (options?.connectionId !== undefined) this.connectionId = options.connectionId;
    this._api = options?.api ?? createFetchStorageApi(() => connectionStore.activeConnectionId);
    this.bookmarks = new BookmarksState(options?.connectionId ?? '');
    // Restore persisted operation history (interrupted ops appear from previous sessions).
    this.operations = loadPersistedOperations();
    // Reconcile interrupted operations that have a server-side job store entry.
    void this.reconcileInterruptedOps();
  }

  get api(): StorageApi {
    return this._api;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Server data sync
  // ────────────────────────────────────────────────────────────────────────────

  syncFromServer(bucket: string, prefix: string, objects: StoragePage): void {
    const bucketChanged = bucket !== this.bucket;
    this.bucket = bucket;
    this.prefix = prefix;
    this.objects = objects;
    if (bucketChanged) this.prevTokens = [];
    this.loading = false;
    this.selectedKeys = new SvelteSet<string>();
    this.archiveKey = null;
    this.archivePrefix = '';
    this.archiveNestedPath = null;
    this.previousS3Prefix = '';
    this.archiveLoading = false;
    this.archiveTooLarge = false;
  }

  /** Add a bucket to the in-memory list (no server-side persistence). */
  addBucket(name: string): void {
    if (!this.buckets.includes(name)) {
      this.buckets = [...this.buckets, name];
    }
  }

  setNavigationHandler(fn: NavigateFn): void {
    this._onNavigate = fn;
  }

  setRefreshHandler(fn: () => void): void {
    this._onRefreshNavigate = fn;
  }

  setTabsInvalidationHandler(fn: (prefix: string) => void): void {
    this._onInvalidateSourceTabs = fn;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Selection
  // ────────────────────────────────────────────────────────────────────────────

  toggleSelect = (key: string, force = false): void => {
    if (force || this.selectionMode) {
      if (force && !this.selectionMode) this.selectionMode = true;
      const next = new SvelteSet<string>(this.selectedKeys);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      this.selectedKeys = next;
    } else {
      this.selectedKeys = new SvelteSet<string>([key]);
    }
  };

  selectAll = (checked: boolean): void => {
    if (checked) {
      this.selectedKeys = new SvelteSet<string>([
        ...this.folders.map((f: StorageObject) => f.key),
        ...this.files.map((f: StorageObject) => f.key)
      ]);
    } else {
      this.selectedKeys = new SvelteSet<string>();
    }
  };

  clearSelection = (): void => {
    this.selectedKeys = new SvelteSet<string>();
    this.selectionMode = false;
  };

  toggleSelectionMode = (): void => {
    this.selectionMode = !this.selectionMode;
    if (!this.selectionMode) this.selectedKeys = new SvelteSet<string>();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Navigation
  // ────────────────────────────────────────────────────────────────────────────

  navigate = (prefix: string): void => {
    this.loading = true;
    this.prevTokens = [];
    this._onNavigate(prefix, null, this.pageSize);
  };

  navigateNext = (): void => {
    this.prevTokens = [...this.prevTokens, this.objects.continuationToken ?? null];
    this.loading = true;
    this._onNavigate(this.prefix, this.objects.nextContinuationToken ?? null, this.pageSize);
  };

  navigatePrev = (): void => {
    const copy = [...this.prevTokens];
    const last = copy.pop() ?? null;
    this.prevTokens = copy;
    this.loading = true;
    this._onNavigate(this.prefix, last, this.pageSize);
  };

  navigateFirst = (): void => {
    this.prevTokens = [];
    this.loading = true;
    this._onNavigate(this.prefix, null, this.pageSize);
  };

  // ── Archive navigation ────────────────────────────────────────────────────

  /** Check if a filename looks like a navigable archive. */
  isArchiveFile = (key: string): boolean => {
    const lower = key.toLowerCase();
    return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  };

  /** Enter an archive file and show its contents as a virtual folder. */
  enterArchive = async (archiveKey: string): Promise<void> => {
    if (this.isInArchive) {
      this.archiveNestedPath = archiveKey;
    } else {
      this.archiveKey = archiveKey;
      this.archiveNestedPath = null;
      this.previousS3Prefix = this.prefix;
    }
    this.archivePrefix = '';
    this.archiveLoading = true;

    try {
      await this._fetchArchiveListing();
    } catch (err) {
      if (this.archiveNestedPath) {
        this.archiveNestedPath = null;
      } else {
        this.archiveKey = null;
        this.previousS3Prefix = '';
      }
      this.archivePrefix = '';
      this.archiveLoading = false;
      addToast('error', err instanceof Error ? err.message : m.storage_archive_open_error());
    }
  };

  /** Navigate within the current archive (virtual path). */
  navigateInArchive = async (prefix: string): Promise<void> => {
    if (!this.archiveKey) return;
    this.archivePrefix = prefix;
    this.archiveLoading = true;
    this.prevTokens = [];

    try {
      await this._fetchArchiveListing();
    } catch (err) {
      this.archiveLoading = false;
      addToast('error', err instanceof Error ? err.message : m.storage_archive_open_error());
    }
  };

  /** Navigate to the root of the outermost archive (clears nested archive state). */
  navigateToOuterArchiveRoot = (): void => {
    this.archiveNestedPath = null;
    this.archivePrefix = '';
    this.archiveLoading = true;
    this.prevTokens = [];
    void this._fetchArchiveListing().catch(() => {
      this.archiveLoading = false;
    });
  };

  /** Navigate up within the archive. If at root, exit the archive or go to parent archive. */
  navigateUpFromArchive = (): void => {
    if (!this.archivePrefix) {
      if (this.archiveNestedPath) {
        // Go back to outer archive root
        this.archiveNestedPath = null;
        this.archivePrefix = '';
        this.archiveLoading = true;
        void this._fetchArchiveListing().catch(() => {
          this.archiveLoading = false;
        });
      } else {
        this.exitArchive();
      }
      return;
    }
    const withoutTrailing = this.archivePrefix.replace(/\/$/, '');
    const lastSlash = withoutTrailing.lastIndexOf('/');
    void this.navigateInArchive(lastSlash === -1 ? '' : withoutTrailing.slice(0, lastSlash + 1));
  };

  /** Exit the archive and return to the S3 folder that contains it. */
  exitArchive = (): void => {
    const s3Prefix = this.previousS3Prefix;
    this.archiveKey = null;
    this.archivePrefix = '';
    this.archiveNestedPath = null;
    this.previousS3Prefix = '';
    this.archiveLoading = false;
    this.archiveTooLarge = false;
    this.loading = true;
    this.prevTokens = [];
    void this._fetchS3Objects(s3Prefix);
  };

  /** Manually fetch S3 objects for the given prefix (used when exiting archive). */
  private async _fetchS3Objects(prefix: string): Promise<void> {
    try {
      const objects = await this.api.list({
        bucket: this.bucket,
        prefix: prefix ?? '',
        pageSize: this.pageSize
      });
      this.prefix = prefix;
      this.objects = objects;
    } catch {
      // Fall back to invalidateAll if manual fetch fails
      void invalidateAll();
    } finally {
      this.loading = false;
    }
  }

  /** Download a file from within the current archive. */
  downloadFromArchive = async (internalPath: string): Promise<void> => {
    if (!this.archiveKey) return;
    try {
      const res = await this.api.archiveExtract({
        bucket: this.bucket,
        key: this.archiveKey,
        path: internalPath,
        nestedArchivePath: this.archiveNestedPath ?? undefined
      });
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const filename = internalPath.split('/').filter(Boolean).pop() ?? internalPath;
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch (err: unknown) {
      if (err instanceof StorageError) {
        addToast('error', getActionErrorMessage(err));
      } else {
        addToast('error', m.storage_download_error_unknown());
      }
    }
  };

  /** Fetch archive listing from the server API. */
  private async _fetchArchiveListing(): Promise<void> {
    if (!this.archiveKey) {
      this.archiveLoading = false;
      return;
    }
    const data = await this.api.archiveListing({
      bucket: this.bucket,
      key: this.archiveKey,
      internalPrefix: this.archivePrefix,
      nestedArchivePath: this.archiveNestedPath ?? undefined
    });
    if (data.tooLarge) {
      this.archiveTooLarge = true;
      this.archiveLoading = false;
      this.objects = { objects: [], hasNextPage: false, currentPage: 1, pageSize: null as never };
      return;
    }
    this.archiveTooLarge = false;
    const prefix = this.archivePrefix || '';
    this.objects = {
      objects: data.entries.map((e) => ({
        key: prefix + e.key,
        size: e.size,
        lastModified: e.lastModified,
        isDirectory: e.isDirectory,
        contentType: undefined
      })),
      hasNextPage: data.hasMore,
      currentPage: 1,
      pageSize: null as never
    };
    this.archiveLoading = false;
  }

  refresh = (): void => {
    if (this.isInArchive) {
      this.archiveLoading = true;
      void this._fetchArchiveListing().catch(() => {
        this.archiveLoading = false;
      });
    } else {
      this.loading = true;
      if (this._onRefreshNavigate) {
        this._onRefreshNavigate();
      } else {
        void invalidateAll();
      }
    }
  };

  onPageSizeChange = (): void => {
    this.prevTokens = [];
    this.navigateFirst();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Modal management
  // ────────────────────────────────────────────────────────────────────────────

  openModal = <T extends ModalType>(type: T, payload: ModalPayloads[T]): void => {
    this.activeModal = { type, payload } as ActiveModal;
  };

  closeModal = (): void => {
    this.activeModal = null;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Context menu
  // ────────────────────────────────────────────────────────────────────────────

  openContextMenu = (e: MouseEvent, key: string): void => {
    e.preventDefault();
    e.stopPropagation();

    if (!this.selectedKeys.has(key)) {
      if (this.selectedKeys.size === 0) {
        this.selectedKeys = new SvelteSet<string>([key]);
      } else {
        this.selectedKeys.add(key);
      }
    }

    this.contextMenu = { x: e.clientX, y: e.clientY, key };
  };

  /** Open the context menu for the empty space (no specific item). */
  openEmptyContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    this.selectedKeys = new SvelteSet<string>();
    this.contextMenu = { x: e.clientX, y: e.clientY };
  };

  closeContextMenu = (): void => {
    if (this.contextMenu?.key) {
      this.selectedKeys.delete(this.contextMenu.key);
    }
    this.contextMenu = null;
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Actions
  // ────────────────────────────────────────────────────────────────────────────

  executeAction = async (action: ActionName): Promise<void> => {
    const ctxKey = this.contextMenu?.key ?? null;
    const ctxFile =
      ctxKey && this.files.find((f: StorageObject) => f.key === ctxKey) ? ctxKey : null;
    const key = ctxFile ?? this.selectedFiles[0]?.key;

    const effectiveSelectedFiles = ctxFile
      ? [this.files.find((f: StorageObject) => f.key === ctxFile)!]
      : this.selectedFiles;

    switch (action) {
      case 'delete':
        this.openModal('delete', { keys: [...this.selectedKeys] });
        return;

      case 'upload':
        this.openModal('upload', { bucket: this.bucket, prefix: this.prefix });
        return;

      case 'preview':
        if (!key) {
          addToast('warning', m.storage_action_preview_no_selection());
          return;
        }
        if (this.isInArchive) {
          this.openModal('preview', {
            key,
            archiveKey: this.archiveKey!,
            archivePath: key,
            nestedArchivePath: this.archiveNestedPath || undefined
          });
          return;
        }
        if (this.isArchiveFile(key)) {
          void this.enterArchive(key);
          return;
        }
        for (const f of effectiveSelectedFiles) {
          this.bookmarks.recordFileVisit(this.bucket, f.key, f.size);
        }
        this.openModal('preview', { key });
        return;

      case 'download':
        if (!key) {
          addToast('warning', m.storage_action_download_no_selection());
          return;
        }
        if (this.isInArchive) {
          void this.downloadFromArchive(key);
          return;
        }
        for (const f of effectiveSelectedFiles) {
          this.bookmarks.recordFileVisit(this.bucket, f.key, f.size);
        }
        try {
          const connectionId = connectionStore.activeConnectionId;
          if (!connectionId) {
            addToast('error', m.storage_download_error_unknown());
            return;
          }
          await downloadObject(this.bucket, key, connectionId);
        } catch (err: unknown) {
          if (err instanceof StorageError) {
            addToast('error', getActionErrorMessage(err));
          } else {
            addToast('error', m.storage_download_error_unknown());
          }
        }
        return;

      case 'pin':
        this.bookmarks.pin(this.bucket, ctxKey ?? this.prefix);
        return;

      case 'unpin':
        this.bookmarks.unpin(this.bucket, ctxKey ?? this.prefix);
        return;

      case 'copy-filename': {
        const nameKey = ctxKey ?? this.selectedFiles[0]?.key;
        if (!nameKey) return;
        try {
          await navigator.clipboard.writeText(keyToName(nameKey));
          addToast('success', m.storage_action_copy_filename_success());
        } catch {
          addToast('error', m.storage_action_copy_filename_error());
        }
        return;
      }

      case 'details': {
        const targetKey = ctxKey ?? this.selectedFiles[0]?.key ?? this.selectedFolders[0]?.key;
        if (!targetKey) {
          addToast('warning', m.storage_action_preview_no_selection());
          return;
        }
        const isDir = targetKey.endsWith('/');
        this.openModal('details', {
          type: isDir ? 'directory' : 'file',
          bucket: this.bucket,
          key: targetKey,
          prefix: isDir ? targetKey : undefined
        });
        return;
      }

      case 'copy-path': {
        const pathKey = ctxKey ?? this.selectedFiles[0]?.key;
        if (!pathKey) return;
        // Strip trailing slash for folders so the URI is canonical.
        const cleanKey = pathKey.endsWith('/') ? pathKey.slice(0, -1) : pathKey;
        try {
          await navigator.clipboard.writeText(`s3://${this.bucket}/${cleanKey}`);
          addToast('success', m.storage_action_copy_path_success());
        } catch {
          addToast('error', m.storage_action_copy_path_error());
        }
        return;
      }

      case 'cut': {
        if (!storageCutCopyEnabled) return;
        const cutKeys = [...this.selectedKeys];
        if (cutKeys.length === 0) return;
        const fileSizes: Record<string, number> = {};
        for (const obj of this.objects.objects) {
          if (cutKeys.includes(obj.key) && !obj.isDirectory) {
            fileSizes[obj.key] = obj.size;
          }
        }
        this.clipboard = {
          action: 'cut',
          keys: cutKeys,
          sourceBucket: this.bucket,
          sourcePrefix: this.prefix,
          fileSizes
        };
        addToast('info', m.storage_action_cut_success({ count: cutKeys.length }));
        return;
      }

      case 'copy': {
        if (!storageCutCopyEnabled) return;
        const copyKeys = [...this.selectedKeys];
        if (copyKeys.length === 0) return;
        const fileSizes: Record<string, number> = {};
        for (const obj of this.objects.objects) {
          if (copyKeys.includes(obj.key) && !obj.isDirectory) {
            fileSizes[obj.key] = obj.size;
          }
        }
        this.clipboard = {
          action: 'copy',
          keys: copyKeys,
          sourceBucket: this.bucket,
          sourcePrefix: this.prefix,
          fileSizes
        };
        addToast('info', m.storage_action_copy_success({ count: copyKeys.length }));
        return;
      }

      case 'paste': {
        if (!storagePasteEnabled) return;
        if (!this.clipboard || this.clipboard.keys.length === 0) return;
        if (this.isInArchive) {
          addToast('warning', m.storage_action_paste_archive_error());
          return;
        }
        const wasCut = this.clipboard.action === 'cut';
        const pasteKeys = [...this.clipboard.keys];
        // If the context menu was opened on a folder, paste inside it
        const destPrefix = ctxKey && ctxKey.endsWith('/') ? ctxKey : this.prefix;

        // ── Check for name conflicts at destination ──────────────────────
        const conflictEntries = await this._checkDestinationConflicts(pasteKeys, destPrefix);
        const hasConflicts = conflictEntries.some((e) => e.conflict);
        if (hasConflicts) {
          const totalBytes = pasteKeys.reduce(
            (sum, k) => sum + (this.clipboard!.fileSizes[k] ?? 0),
            0
          );
          this._pendingConflictOp = {
            type: 'paste',
            keys: pasteKeys,
            sourceBucket: this.clipboard.sourceBucket,
            destPrefix,
            wasCut,
            fileSizes: this.clipboard.fileSizes,
            sourcePrefix: this.clipboard.sourcePrefix,
            totalBytes
          };
          this.openModal('resolve-conflicts', {
            entries: conflictEntries,
            bucket: this.bucket,
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
        // Sum total bytes from clipboard file sizes
        const totalBytes = pasteKeys.reduce(
          (sum, k) => sum + (this.clipboard!.fileSizes[k] ?? 0),
          0
        );
        this._startOp(
          opId,
          pasteLabel,
          'paste',
          pasteKeys.length,
          abortController,
          `${this.bucket}/${destPrefix}`,
          sourceNames,
          totalBytes
        );
        try {
          let completedBytes = 0;
          const fileSizes = this.clipboard?.fileSizes ?? {};
          const pasteSourceNames = pasteKeys.map((k) => keyToName(k));
          const fileJobIdsAccum: string[] = [];
          const { results, failed } = await this.performPasteSequential(
            pasteKeys,
            this.clipboard.sourceBucket,
            destPrefix,
            wasCut,
            abortController.signal,
            (index, key) => {
              // File-level progress: use the known file size from clipboard.
              completedBytes += fileSizes[key] ?? 0;
              this._updateOpProgress(opId, index, completedBytes, keyToName(key));
            },
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            (loaded, _total) => {
              // Byte-level progress during a large file's streaming upload.
              // loaded comes from the server's onUploadProgress for the current
              // file. We compute the absolute position by adding the sizes of
              // all previously completed files.
              const prevFiles = this.operations.find((op) => op.id === opId)?.completedCount ?? 0;
              let prevBytes = 0;
              for (let j = 0; j < prevFiles && j < pasteKeys.length; j++) {
                prevBytes += fileSizes[pasteKeys[j]] ?? 0;
              }
              this._updateOpProgress(
                opId,
                prevFiles,
                prevBytes + loaded,
                pasteSourceNames[prevFiles] ?? ''
              );
            },
            (index, jobId) => {
              fileJobIdsAccum[index] = jobId;
              this._updateOpJobIds(opId, [...fileJobIdsAccum]);
            }
          );
          await tick();
          if (results.length === 0) {
            this._finishOp(opId, 'error');
            addToast('error', m.storage_action_paste_error_source_not_found());
            return;
          }
          this._finishOp(opId, failed > 0 ? 'error' : 'done');
          // Record destination files as recent visits
          const newFileSizes: Record<string, number> = {};
          for (const r of results) {
            if (r.destKey.endsWith('/')) continue;
            const size = this.clipboard.fileSizes?.[r.sourceKey] ?? 0;
            newFileSizes[r.destKey] = size;
            this.bookmarks.recordFileVisit(this.bucket, r.destKey, size);
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
            if (this.clipboard.sourcePrefix && this._onInvalidateSourceTabs) {
              this._onInvalidateSourceTabs(this.clipboard.sourcePrefix);
            }
            this.clipboard = {
              action: 'copy',
              keys: destKeys,
              sourceBucket: this.bucket,
              sourcePrefix: this.prefix,
              fileSizes: newFileSizes
            };
          }
          this.refresh();
          // Invalidate background tabs viewing the destination
          if (this._onInvalidateSourceTabs) {
            this._onInvalidateSourceTabs(destPrefix);
          }
        } catch (err: unknown) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            this._finishOp(opId, 'cancelled');
            return;
          }
          if (pageUnloading) {
            // Page is unloading — server-side copies continue regardless.
            // The operation persists as 'running' in localStorage and will
            // appear as 'interrupted' on the next page load.
            return;
          }
          this._finishOp(opId, 'error');
          addToast(
            'error',
            err instanceof ActionError ? getActionErrorMessage(err) : m.storage_action_paste_error()
          );
        }
        return;
      }

      case 'rename': {
        if (!storageRenameEnabled) return;
        const renameKey = ctxKey ?? [...this.selectedKeys][0];
        if (!renameKey) return;
        this.renameError = null;
        this.renameLoading = false;
        this.openModal('rename', { key: renameKey });
        return;
      }

      case 'create-file':
        this.openModal('create', { type: 'file' });
        return;

      case 'create-folder':
        this.openModal('create', { type: 'folder' });
        return;
    }
  };

  confirmCreate = async (name: string, type: 'file' | 'folder'): Promise<void> => {
    const sanitized = name.trim();
    if (!sanitized || sanitized === '.' || sanitized === '..') return;

    this.closeModal();
    this.loading = true;

    try {
      const isFolder = type === 'folder';
      const parts = sanitized.split('/');

      // Create intermediate directory markers
      for (let i = 0; i < parts.length - 1; i++) {
        const dirKey = this.prefix + parts.slice(0, i + 1).join('/') + '/';
        await this.api.create({ bucket: this.bucket, key: dirKey });
      }

      // Create the final object (file or directory)
      const finalKey = this.prefix + sanitized + (isFolder ? '/' : '');
      await this.api.create({ bucket: this.bucket, key: finalKey });

      void invalidateAll();
    } catch {
      addToast('error', m.storage_create_error({ name: sanitized }));
      this.loading = false;
    }
  };

  cancelCreate = (): void => {
    this.closeModal();
  };

  confirmDelete = async (): Promise<void> => {
    const modal = this.activeModal;
    if (!modal || modal.type !== 'delete') return;

    const keys = modal.payload.keys;
    this.closeModal();
    this.deleting = true;

    try {
      const result = await this.performDelete(this.bucket, keys);
      if (result.failed && result.failed.length > 0) {
        addToast('warning', m.storage_delete_partial_failure({ count: result.failed.length }));
      }
      this.selectedKeys = new SvelteSet<string>();
      this.selectionMode = false;
      this.refresh();
    } catch (err: unknown) {
      this.loading = false;
      let msg = m.storage_delete_error_unknown();
      if (err instanceof StorageError) {
        if (err.code === 'not_connected') msg = m.storage_delete_error_not_connected();
        else if (err.code === 'access_denied') msg = m.storage_delete_error_access_denied();
        else if (err.code === 'server_error') msg = m.storage_delete_error_server_error();
      }
      addToast('error', msg);
    } finally {
      this.deleting = false;
    }
  };

  cancelDelete = (): void => {
    this.closeModal();
  };

  handleUploadSuccess = (): void => {
    this.closeModal();
    this.refresh();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Paste implementation
  // ────────────────────────────────────────────────────────────────────────────

  private async performPaste(
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
      return this.api.move({
        bucket: this.bucket,
        sourceKeys: keys,
        destinationPrefix: destPrefix,
        signal
      });
    }
    return this.api.copy({
      bucket: this.bucket,
      sourceKeys: keys,
      destinationPrefix: destPrefix,
      signal
    });
  }

  /**
   * Process paste/move keys one at a time, calling `onFileComplete` after
   * each file so the caller can update byte-level progress.
   *
   * Uses `?progress=true` to stream NDJSON progress events from the server,
   * allowing real-time byte-level updates for large files (> 5 GB) that go
   * through multipart streaming upload.
   */
  private async performPasteSequential(
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
      ? (params: Parameters<StorageApi['move']>[0]) => this.api.move(params)
      : (params: Parameters<StorageApi['copy']>[0]) => this.api.copy(params);

    for (let i = 0; i < keys.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      const sourceKey = keys[i];
      const fileJobId = crypto.randomUUID();
      fileJobIds.push(fileJobId);
      onFileJobId?.(i, fileJobId);

      try {
        const result = await moveFn({
          bucket: this.bucket,
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

  // ────────────────────────────────────────────────────────────────────────────
  // Rename
  // ────────────────────────────────────────────────────────────────────────────

  confirmRename = async (key: string, newName: string): Promise<void> => {
    this.renameLoading = true;
    this.renameError = null;

    if (!newName.trim()) {
      this.renameLoading = false;
      return;
    }

    const parts = key.split('/').filter(Boolean);
    parts.pop();
    const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    const newKey = parentPrefix + newName + (key.endsWith('/') ? '/' : '');

    if (newKey === key) {
      this.renameLoading = false;
      this.closeModal();
      return;
    }

    const opId = crypto.randomUUID();
    const renameObj = this.files.find((f) => f.key === key);
    this._startOp(
      opId,
      `${m.storage_operation_rename()}: ${keyToName(key)} → ${newName}`,
      'rename',
      1,
      undefined,
      `${this.bucket}/${newKey}`,
      [keyToName(key)],
      renameObj?.size ?? 0
    );

    try {
      try {
        await this.api.rename({ bucket: this.bucket, key, newKey });
      } catch (err: unknown) {
        this._finishOp(opId, 'error');
        this.renameLoading = false;
        if (err instanceof StorageError && err.code === 'conflict') {
          this.renameError = m.storage_rename_error_conflict({ name: newName });
          return;
        }
        this.closeModal();
        let msg = m.storage_rename_error({ name: newName });
        if (err instanceof StorageError && err.code === 'access_denied')
          msg = m.storage_rename_error_access_denied();
        else if (err instanceof StorageError && err.code === 'not_found')
          msg = m.storage_rename_error_not_found();
        addToast('error', msg);
        return;
      }

      // Update recent files
      if (!key.endsWith('/')) {
        this.bookmarks.removeFiles(this.bucket, [key]);
        const obj = this.files.find((f) => f.key === key);
        if (obj) {
          this.bookmarks.recordFileVisit(this.bucket, newKey, obj.size);
        }
      }

      this._updateOpProgress(opId, 1, renameObj?.size ?? 0);
      await tick();
      this._finishOp(opId, 'done');
      this.renameLoading = false;
      this.closeModal();
      addToast('success', m.storage_rename_success({ name: newName }));
      this.refresh();
    } catch {
      this._finishOp(opId, 'error');
      this.renameLoading = false;
      this.closeModal();
      addToast('error', m.storage_rename_error({ name: newName }));
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Move (used by drag-and-drop)
  // ────────────────────────────────────────────────────────────────────────────

  /** Validate a drag-and-drop move and open the confirmation dialog.
   *  The actual API call happens in `confirmMove` after the user confirms. */
  performMove = (destPrefix: string, keys?: string[]): void => {
    if (!storageMoveEnabled) return;
    const moveKeys = keys ?? [...this.selectedKeys];
    if (moveKeys.length === 0) return;

    // Don't move items that are already directly inside destPrefix (no-op).
    // This is more precise than comparing destPrefix to this.prefix, which
    // would incorrectly block cross-tab drops onto the destination directory.
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
      const obj = this.objects.objects.find((o) => o.key === key);
      return {
        key,
        name: keyToName(key),
        isDirectory: key.endsWith('/'),
        size: obj && !obj.isDirectory ? obj.size : undefined
      };
    });

    this.openModal('confirm-move', { keys: moveKeys, destPrefix, items });
    // Derive source prefix from the keys being moved (common parent directory).
    // Cannot use this.prefix because after a cross-tab drop the active tab is
    // already the destination, so this.prefix equals destPrefix.
    this._pendingSourcePrefix = this._commonPrefix(moveKeys);
  };

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

  confirmMove = async (): Promise<void> => {
    const modal = this.activeModal;
    if (!modal || modal.type !== 'confirm-move') return;
    const { keys: moveKeys, destPrefix, items } = modal.payload;
    this.closeModal();

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
      this.openModal('resolve-conflicts', {
        entries: conflictEntries,
        bucket: this.bucket,
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
    this._startOp(
      opId,
      moveLabel,
      'move',
      moveKeys.length,
      abortController,
      `${this.bucket}/${destPrefix}`,
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
        this._updateOpJobIds(opId, [...fileJobIds]);

        try {
          const result = await this.api.move({
            bucket: this.bucket,
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
                this._updateOpProgress(opId, i + 1, prevBytes + loaded, keyToName(sourceKey));
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
          this._updateOpProgress(opId, i + 1, completedBytes, keyToName(sourceKey));
        } catch {
          failed++;
        }
      }

      await tick();
      this._finishOp(opId, failed === 0 ? 'done' : 'error');

      if (results.length > 0) {
        addToast('success', m.storage_action_move_success({ count: results.length }));
        const movedKeys = results.map((r) => r.sourceKey).filter((k) => !k.endsWith('/'));
        if (movedKeys.length > 0) {
          this.bookmarks.removeFiles(this.bucket, movedKeys);
        }
        for (const r of results) {
          if (!r.destKey.endsWith('/')) {
            const obj = this.files.find((f) => f.key === r.sourceKey);
            if (obj) {
              this.bookmarks.recordFileVisit(this.bucket, r.destKey, obj.size);
            }
          }
        }
      }
      if (failed > 0) {
        addToast('warning', m.storage_action_move_partial({ count: failed }));
      }

      this.selectedKeys = new SvelteSet<string>();
      this.selectionMode = false;
      if (this._pendingSourcePrefix !== null && this._onInvalidateSourceTabs) {
        this._onInvalidateSourceTabs(this._pendingSourcePrefix);
        this._pendingSourcePrefix = null;
      }
      // Invalidate background tabs viewing the destination
      if (this._onInvalidateSourceTabs) {
        this._onInvalidateSourceTabs(destPrefix);
      }
      this.refresh();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._finishOp(opId, 'cancelled');
        this._pendingSourcePrefix = null;
        return;
      }
      if (pageUnloading) {
        return;
      }
      this._finishOp(opId, 'error');
      this._pendingSourcePrefix = null;
      addToast('error', m.storage_action_move_error());
    }
  };

  cancelMove = (): void => {
    this.closeModal();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Conflict resolution (paste / move)
  // ────────────────────────────────────────────────────────────────────────────

  /**
   * Check which destination keys already exist, returning ConflictEntry[]
   * with conflict=true for existing keys.
   */
  private async _checkDestinationConflicts(
    keys: string[],
    destPrefix: string
  ): Promise<ConflictEntry[]> {
    const results: ConflictEntry[] = [];

    for (const key of keys) {
      const origName = keyToName(key);
      const destKey = destPrefix + origName;
      let conflict = false;
      try {
        conflict = await this.api.checkObjectExists({ bucket: this.bucket, key: destKey });
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

  confirmConflictResolution = async (resolvedEntries: ConflictEntry[]): Promise<void> => {
    const pending = this._pendingConflictOp;
    if (!pending) return;
    this._pendingConflictOp = null;
    this.closeModal();

    if (pending.type === 'paste') {
      await this._executePasteWithConflicts(pending, resolvedEntries);
    } else {
      await this._executeMoveWithConflicts(pending, resolvedEntries);
    }
  };

  cancelConflictResolution = (): void => {
    this._pendingConflictOp = null;
    this.closeModal();
  };

  /**
   * Delete conflicting destination files before copy/move to prevent
   * the server from auto-renaming them with " (2)" suffix.
   */
  private async _deleteConflictingDests(
    destPrefix: string,
    resolvedEntries: ConflictEntry[]
  ): Promise<void> {
    const keysToDelete: string[] = [];
    for (const entry of resolvedEntries) {
      if (entry.resolution === 'skip' || entry.resolution === 'rename') continue;
      if (entry.conflict) {
        keysToDelete.push(destPrefix + entry.originalName);
      }
    }

    if (keysToDelete.length === 0) return;

    try {
      await this.api.delete({ bucket: this.bucket, keys: keysToDelete });
    } catch {
      // Best-effort - if deletion fails, the server may auto-rename
    }
  }

  /**
   * Execute a paste operation with conflict resolutions.
   * Renamed entries are first pasted with their original name, then renamed.
   */
  private async _executePasteWithConflicts(
    pending: {
      keys: string[];
      sourceBucket: string;
      destPrefix: string;
      wasCut: boolean;
      fileSizes: Record<string, number>;
      sourcePrefix: string;
      totalBytes: number;
    },
    resolvedEntries: ConflictEntry[]
  ): Promise<void> {
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

    this._startOp(
      opId,
      pasteLabel,
      'paste',
      replaceKeys.length + renameKeys.length,
      abortController,
      `${this.bucket}/${pending.destPrefix}`,
      sourceNames,
      pending.totalBytes
    );

    await this._deleteConflictingDests(pending.destPrefix, resolvedEntries);

    try {
      const { results, failed } = await this.performPasteSequential(
        replaceKeys,
        pending.sourceBucket,
        pending.destPrefix,
        pending.wasCut,
        abortController.signal,
        (index, key) => {
          this._updateOpProgress(opId, index, 0, keyToName(key));
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        (loaded, _total) => {
          const prevFiles = this.operations.find((op) => op.id === opId)?.completedCount ?? 0;
          this._updateOpProgress(opId, prevFiles, loaded, '');
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
          await this.api.rename({ bucket: this.bucket, key: destKey, newKey });
          this._updateOpProgress(
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
      this._finishOp(opId, totalFailed > 0 ? 'error' : 'done');

      if (totalFailed > 0) {
        addToast('warning', m.storage_action_paste_partial({ count: totalFailed }));
      } else {
        addToast(
          'success',
          m.storage_action_paste_success({ count: replaceKeys.length + renameKeys.length })
        );
      }
      this.refresh();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._finishOp(opId, 'cancelled');
        return;
      }
      if (pageUnloading) {
        return;
      }
      this._finishOp(opId, 'error');
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
    pending: {
      keys: string[];
      destPrefix: string;
      items: Array<{ key: string; name: string; isDirectory: boolean; size?: number }>;
      sourcePrefix: string | null;
      totalBytes: number;
    },
    resolvedEntries: ConflictEntry[]
  ): Promise<void> {
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

    this._startOp(
      opId,
      moveLabel,
      'move',
      totalCount,
      abortController,
      `${this.bucket}/${pending.destPrefix}`,
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
          await this.api.rename({
            bucket: this.bucket,
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
          const result = await this.api.move({
            bucket: this.bucket,
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
        this._updateOpProgress(opId, results.length, 0, keyToName(key));
      }

      await tick();
      const totalFailed = renameFailed + failed;
      this._finishOp(opId, totalFailed === 0 ? 'done' : 'error');

      if (results.length > 0) {
        addToast('success', m.storage_action_move_success({ count: results.length }));
        const movedKeys = results.map((r) => r.sourceKey).filter((k) => !k.endsWith('/'));
        if (movedKeys.length > 0) {
          this.bookmarks.removeFiles(this.bucket, movedKeys);
        }
      }
      if (totalFailed > 0) {
        addToast('warning', m.storage_action_move_partial({ count: totalFailed }));
      }

      this.selectedKeys = new SvelteSet<string>();
      this.selectionMode = false;
      if (pending.sourcePrefix !== null && this._onInvalidateSourceTabs) {
        this._onInvalidateSourceTabs(pending.sourcePrefix);
      }
      // Invalidate background tabs viewing the destination
      if (this._onInvalidateSourceTabs) {
        this._onInvalidateSourceTabs(pending.destPrefix);
      }
      this.refresh();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        this._finishOp(opId, 'cancelled');
        return;
      }
      if (pageUnloading) {
        return;
      }
      this._finishOp(opId, 'error');
      addToast('error', m.storage_action_move_error());
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Keyboard shortcuts
  // ────────────────────────────────────────────────────────────────────────────

  handleKeydown = (e: KeyboardEvent): void => {
    if (this.activeModal?.type === 'delete') return;
    if (this.isInArchive && e.key !== 'Escape') return;

    const isCtrl = e.ctrlKey || e.metaKey;

    if (e.key === 'Delete' && this.selectedKeys.size > 0) {
      this.openModal('delete', { keys: [...this.selectedKeys] });
    } else if (e.key === 'Escape') {
      if (this.contextMenu) {
        this.closeContextMenu();
      }
      if (this.selectedKeys.size > 0) {
        this.clearSelection();
      }
    } else if (isCtrl && e.key === 'x') {
      e.preventDefault();
      if (!this.isInArchive && this.selectedKeys.size > 0) {
        void this.executeAction('cut');
      }
    } else if (isCtrl && e.key === 'c') {
      e.preventDefault();
      if (!this.isInArchive && this.selectedKeys.size > 0) {
        void this.executeAction('copy');
      }
    } else if (isCtrl && e.key === 'v') {
      e.preventDefault();
      if (!this.isInArchive && this.clipboard) {
        void this.executeAction('paste');
      }
    } else if (e.key === 'F2') {
      if (!this.isInArchive && this.selectedKeys.size === 1) {
        void this.executeAction('rename');
      }
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Private: Operations tracking helpers
  // ────────────────────────────────────────────────────────────────────────────

  private _startOp(
    id: string,
    label: string,
    type: StorageOperation['type'],
    itemCount: number,
    abortController?: AbortController,
    destPath?: string,
    sourceNames?: string[],
    totalBytes = 0
  ): void {
    this.operations = [
      ...this.operations,
      {
        id,
        label,
        status: 'running',
        type,
        itemCount,
        completedCount: 0,
        startedAt: Date.now(),
        destPath,
        sourceNames,
        totalBytes,
        completedBytes: 0
      }
    ];
    if (abortController) {
      this._abortControllers.set(id, abortController);
    }
    // Persist immediately so a refresh shows the op as interrupted.
    saveOperationsToStorage(this.operations);
  }

  private _updateOpProgress(
    id: string,
    completedCount: number,
    completedBytes: number,
    currentFileName?: string
  ): void {
    this.operations = this.operations.map((op) =>
      op.id === id && op.status !== 'cancelled'
        ? { ...op, completedCount, completedBytes, currentFileName }
        : op
    );
  }

  private _updateOpJobIds(id: string, fileJobIds: string[]): void {
    this.operations = this.operations.map((op) => (op.id === id ? { ...op, fileJobIds } : op));
    saveOperationsToStorage(this.operations);
  }

  private _finishOp(
    id: string,
    status: 'done' | 'error' | 'cancelled',
    errorMessage?: string
  ): void {
    this.operations = this.operations.map((op) =>
      op.id === id && op.status !== 'cancelled'
        ? { ...op, status, errorMessage, completedAt: Date.now() }
        : op
    );
    this._abortControllers.delete(id);
    saveOperationsToStorage(this.operations);
  }

  /**
   * For interrupted operations that have fileJobIds, poll the server job store
   * to recover actual results. Updates operations in place.
   * For jobs still running, polls periodically to show live progress.
   */
  private async reconcileInterruptedOps(): Promise<void> {
    const interrupted = this.operations.filter(
      (op) => op.status === 'interrupted' && op.fileJobIds && op.fileJobIds.length > 0
    );
    if (interrupted.length === 0) return;

    for (const op of interrupted) {
      void this._pollJobStatus(op);
    }
  }

  /**
   * Poll the server job store for a single operation's status.
   * Updates the operation's progress and status in real-time.
   */
  private _pollTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();

  private async _pollJobStatus(op: StorageOperation): Promise<void> {
    // If the operation was cancelled while we were waiting to poll, stop.
    if (this.operations.find((o) => o.id === op.id)?.status === 'cancelled') return;

    let completedCount = 0;
    let completedBytes = 0;
    let anyRunning = false;

    for (const jobId of op.fileJobIds!) {
      try {
        const job = await this.api.pollJob(jobId);
        if (job.status === 'done') {
          completedCount++;
        } else if (job.status === 'running') {
          anyRunning = true;
          completedBytes += job.progress?.completedBytes ?? 0;
        }
      } catch {
        // Job may have expired
      }
    }

    // Update the operation — switch to 'running' if still in progress so the
    // progress display shows live data instead of a static "interrupted" message.
    if (anyRunning) {
      this.operations = this.operations.map((o) =>
        o.id === op.id
          ? {
              ...o,
              status: 'running' as const,
              completedCount,
              completedBytes,
              completedAt: undefined
            }
          : o
      );
      // Poll again in 2 seconds
      const timer = setTimeout(() => void this._pollJobStatus(op), 2000);
      this._pollTimers.set(op.id, timer);
    } else {
      // All jobs resolved — mark operation as done (or partially failed)
      this.operations = this.operations.map((o) =>
        o.id === op.id
          ? {
              ...o,
              status: (completedCount === op.itemCount ? 'done' : 'error') as 'done' | 'error',
              completedCount,
              completedBytes,
              completedAt: Date.now()
            }
          : o
      );
      saveOperationsToStorage(this.operations);

      // Clean up any lingering timer
      const existing = this._pollTimers.get(op.id);
      if (existing) {
        clearTimeout(existing);
        this._pollTimers.delete(op.id);
      }

      // Refresh the current view if the operation was writing to the
      // directory the user is currently browsing (or a parent of it).
      if (op.destPath && `${this.bucket}/${this.prefix}`.startsWith(op.destPath)) {
        this.refresh();
      }

      // Invalidate background tabs whose prefix matches the destination
      if (op.destPath && this._onInvalidateSourceTabs) {
        const slashIdx = op.destPath.indexOf('/');
        if (slashIdx !== -1) {
          const prefix = op.destPath.slice(slashIdx + 1);
          this._onInvalidateSourceTabs(prefix.endsWith('/') ? prefix : prefix + '/');
        }
      }
    }
  }

  /** Remove all completed/failed/cancelled/interrupted operations from history. */
  clearOperationHistory = (): void => {
    this.operations = this.operations.filter((op) => op.status === 'running');
    saveOperationsToStorage(this.operations);
  };

  cancelOp = (id: string): void => {
    const controller = this._abortControllers.get(id);
    if (controller) {
      controller.abort();
    }
    // Stop polling for re-acquired operations (restored from localStorage
    // after a page refresh — these have no AbortController to cancel).
    const timer = this._pollTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._pollTimers.delete(id);
    }
    this._finishOp(id, 'cancelled');
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Private: Delete implementation
  // ────────────────────────────────────────────────────────────────────────────

  private async performDelete(
    bucket: string,
    keys: string[]
  ): Promise<{ failed: Array<{ key: string; code?: string; message?: string }> }> {
    const result = await this.api.delete({ bucket, keys });

    // Clean up pinned locations and recent items for deleted paths
    const dirPrefixes = keys.filter((k) => k.endsWith('/'));
    const fileKeys = keys.filter((k) => !k.endsWith('/'));
    if (dirPrefixes.length > 0) {
      this.bookmarks.unpinUnderDirectories(bucket, dirPrefixes);
      this.bookmarks.removeItemsUnderDirectories(bucket, dirPrefixes);
    }
    if (fileKeys.length > 0) {
      this.bookmarks.removeFiles(bucket, fileKeys);
    }

    // Remove deleted keys from clipboard if they match the current bucket
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

    return result;
  }
}
