import { SvelteSet } from 'svelte/reactivity';
import { tick } from 'svelte';
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
  StorageOperation
} from '$lib/storage/types.js';
import { initPageSize, type PageSize } from '$lib/types/pagination.js';
import {
  defaultPageSize,
  storageCutCopyEnabled,
  storagePasteEnabled,
  storageRenameEnabled
} from '$lib/client/feature-flags.js';
import { downloadObject } from '$lib/storage/download.js';
import type { ConflictEntry } from '$lib/components/storage/modals/shared/conflict-types.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { StorageError, getActionErrorMessage } from './errors.js';
import { BookmarksState } from './bookmarks.svelte.js';
import { connectionStore } from '$lib/storage/connection-store.svelte.js';
import { keyToName } from '$lib/storage/utils.js';
import type { StorageApi } from './api.js';
import { createFetchStorageApi } from './api.js';
import { OperationsState } from './operations.svelte.js';
import { ArchiveState } from './archive.svelte.js';
import { ClipboardState } from './clipboard.svelte.js';

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
  connectionHostname = $state('');

  // ── Pagination ──
  prevTokens = $state<(string | null)[]>([]);
  pageSize = $state<PageSize>(initPageSize('storage_page_size'));
  currentPage = $derived(this.prevTokens.length + 1);

  // ── Composed sub-state ──
  bookmarks: BookmarksState;
  archive: ArchiveState;
  clipboardState: ClipboardState;

  /**
   * Delegated clipboard data getter for backward compatibility.
   * Components access `storage.clipboard` to read the current clipboard.
   */
  get clipboard(): import('$lib/storage/types.js').ClipboardData | null {
    return this.clipboardState.clipboard;
  }

  // ── Operations (paste / move / rename progress) ──
  private operations_: OperationsState;

  get operations(): StorageOperation[] {
    return this.operations_.operations;
  }

  get hasRunningOps(): boolean {
    return this.operations_.hasRunningOps;
  }

  /** Delegated to clipboardState. */
  isCutKey(key: string): boolean {
    return this.clipboardState.isCutKey(key, this.bucket);
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
    this.operations_ = new OperationsState(this._api, {
      getBucket: () => this.bucket,
      getPrefix: () => this.prefix,
      onRefresh: () => this.refresh(),
      onInvalidateTabs: (prefix) => this._onInvalidateSourceTabs?.(prefix)
    });
    this.archive = new ArchiveState(this._api, {
      getBucket: () => this.bucket,
      getPrefix: () => this.prefix,
      getPageSize: () => this.pageSize,
      setObjects: (objects) => {
        this.objects = objects;
      },
      setLoading: (loading) => {
        this.loading = loading;
      },
      setPrefix: (prefix) => {
        this.prefix = prefix;
      },
      clearPrevTokens: () => {
        this.prevTokens = [];
      },
      onExit: (s3Prefix) => {
        this.loading = true;
        this.prevTokens = [];
        void this.archive._fetchS3Objects(s3Prefix);
      }
    });
    this.clipboardState = new ClipboardState(this._api, this.operations_, {
      getBucket: () => this.bucket,
      getPrefix: () => this.prefix,
      getObjects: () => this.objects,
      getSelectedKeys: () => this.selectedKeys,
      openModal: (type, payload) => this.openModal(type as never, payload as never),
      closeModal: () => this.closeModal(),
      refresh: () => this.refresh(),
      invalidateSourceTabs: (prefix) => this._onInvalidateSourceTabs?.(prefix),
      recordFileVisit: (bucket, key, size) => this.bookmarks.recordFileVisit(bucket, key, size),
      removeFiles: (bucket, keys) => this.bookmarks.removeFiles(bucket, keys),
      clearSelection: () => {
        this.selectedKeys = new SvelteSet<string>();
        this.selectionMode = false;
      }
    });
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
    this.archive.reset();
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

  refresh = (): void => {
    if (this.archive.isInArchive) {
      this.archive.refreshListing();
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
      this.selectedKeys = new SvelteSet<string>([key]);
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
        if (this.archive.isInArchive) {
          this.openModal('preview', {
            key,
            archiveKey: this.archive.archiveKey!,
            archivePath: key,
            nestedArchivePath: this.archive.nestedArchivePath
          });
          return;
        }
        if (this.archive.isArchiveFile(key)) {
          void this.archive.enterArchive(key);
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
        if (this.archive.isInArchive) {
          void this.archive.downloadFromArchive(key);
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
        await this.copyFilename(nameKey);
        return;
      }

      case 'copy-path': {
        const pathKey = ctxKey ?? this.selectedFiles[0]?.key;
        if (!pathKey) return;
        await this.copyPath(this.bucket, pathKey);
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

      case 'cut': {
        if (!storageCutCopyEnabled) return;
        const cutKeys = [...this.selectedKeys];
        if (cutKeys.length === 0) return;
        this.clipboardState.cut(cutKeys, this.objects, this.bucket, this.prefix);
        return;
      }

      case 'copy': {
        if (!storageCutCopyEnabled) return;
        const copyKeys = [...this.selectedKeys];
        if (copyKeys.length === 0) return;
        this.clipboardState.copy(copyKeys, this.objects, this.bucket, this.prefix);
        return;
      }

      case 'paste': {
        if (!storagePasteEnabled) return;
        if (!this.clipboardState.clipboard || this.clipboardState.clipboard.keys.length === 0)
          return;
        if (this.archive.isInArchive) {
          addToast('warning', m.storage_action_paste_archive_error());
          return;
        }
        const ctxKey = this.contextMenu?.key ?? null;
        const destPrefix = ctxKey && ctxKey.endsWith('/') ? ctxKey : this.prefix;
        await this.clipboardState.paste(destPrefix);
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

  copyFilename = async (key: string): Promise<void> => {
    try {
      const name = key ? keyToName(key) : this.bucket;
      await navigator.clipboard.writeText(name);
      const isDir = !key || key.endsWith('/');
      addToast(
        'success',
        isDir
          ? m.storage_action_copy_directory_name_success()
          : m.storage_action_copy_filename_success()
      );
    } catch {
      const isDir = !key || key.endsWith('/');
      addToast(
        'error',
        isDir
          ? m.storage_action_copy_directory_name_error()
          : m.storage_action_copy_filename_error()
      );
    }
  };

  copyPath = async (bucket: string, key: string): Promise<void> => {
    const cleanKey = key.endsWith('/') ? key.slice(0, -1) : key;
    try {
      await navigator.clipboard.writeText(`s3://${bucket}/${cleanKey}`);
      addToast('success', m.storage_action_copy_path_success());
    } catch {
      addToast('error', m.storage_action_copy_path_error());
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

  // ── Delegate methods ───────────────────────────────────────────────────────

  /** Delegated to clipboardState. */
  performMove = (destPrefix: string, keys?: string[]): void => {
    this.clipboardState.performMove(destPrefix, keys);
  };

  /** Delegated to clipboardState. */
  confirmMove = (): Promise<void> => {
    return this.clipboardState.confirmMove();
  };

  /** Delegated to clipboardState. */
  cancelMove = (): void => {
    this.clipboardState.cancelMove();
  };

  /** Delegated to clipboardState. */
  confirmConflictResolution = (entries: ConflictEntry[]): Promise<void> => {
    return this.clipboardState.confirmConflictResolution(entries);
  };

  /** Delegated to clipboardState. */
  cancelConflictResolution = (): void => {
    this.clipboardState.cancelConflictResolution();
  };

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
    this.operations_.startOp(
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
        this.operations_.finishOp(opId, 'error');
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

      this.operations_.updateOpProgress(opId, 1, renameObj?.size ?? 0);
      await tick();
      this.operations_.finishOp(opId, 'done');
      this.renameLoading = false;
      this.closeModal();
      addToast('success', m.storage_rename_success({ name: newName }));
      this.refresh();
    } catch {
      this.operations_.finishOp(opId, 'error');
      this.renameLoading = false;
      this.closeModal();
      addToast('error', m.storage_rename_error({ name: newName }));
    }
  };

  // ── (Move and conflict resolution moved to ClipboardState) ──

  // ────────────────────────────────────────────────────────────────────────────
  // Keyboard shortcuts
  // ────────────────────────────────────────────────────────────────────────────

  handleKeydown = (e: KeyboardEvent): void => {
    if (this.activeModal) return;
    if (this.archive.isInArchive && e.key !== 'Escape') return;

    const isCtrl = e.ctrlKey || e.metaKey;

    if (e.key === 'Delete' && this.selectedKeys.size > 0) {
      this.openModal('delete', { keys: [...this.selectedKeys] });
    } else if (e.key === 'Escape') {
      if (this.contextMenu) {
        this.closeContextMenu();
      } else {
        this.clearSelection();
      }
      if (this.selectedKeys.size > 0) {
        this.clearSelection();
      }
    } else if (isCtrl && e.key === 'x') {
      e.preventDefault();
      if (!this.archive.isInArchive && this.selectedKeys.size > 0) {
        void this.executeAction('cut');
      }
    } else if (isCtrl && e.key === 'c') {
      e.preventDefault();
      if (!this.archive.isInArchive && this.selectedKeys.size > 0) {
        void this.executeAction('copy');
      }
    } else if (isCtrl && e.key === 'v') {
      e.preventDefault();
      if (!this.archive.isInArchive && this.clipboard) {
        void this.executeAction('paste');
      }
    } else if (isCtrl && e.key === 'a') {
      e.preventDefault();
      this.selectAll(!this.allSelected);
    } else if (e.key === 'F2') {
      if (!this.archive.isInArchive && this.selectedKeys.size === 1) {
        void this.executeAction('rename');
      }
    }
  };

  cancelOp = (id: string): void => {
    this.operations_.cancelOp(id);
  };

  clearOperationHistory = (): void => {
    this.operations_.clearOperationHistory();
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
    this.clipboardState.removeDeletedKeys(bucket, keys);

    return result;
  }
}
