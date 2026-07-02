import { SvelteSet, SvelteURLSearchParams } from 'svelte/reactivity';
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
  ArchiveListingResponse,
  ArchiveEntry
} from '$lib/storage/types.js';
import { ARCHIVE_EXTENSIONS } from '$lib/storage/types.js';
import { initPageSize, type PageSize } from '$lib/types/pagination.js';
import {
  defaultPageSize,
  storageCutCopyEnabled,
  storagePasteEnabled,
  storageRenameEnabled
} from '$lib/client/feature-flags.js';
import { downloadObject, DownloadError } from '$lib/storage/download.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { ActionError, getActionErrorMessage } from './errors.js';
import { BookmarksState } from './bookmarks.svelte.js';
import { loadConnectionLocally, getConnectionHeader } from '$lib/storage/connection-storage.js';
import { keyToName } from '$lib/storage/utils.js';

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
    if (!this.contextMenu) return null;
    return this.files.find((f: StorageObject) => f.key === this.contextMenu!.key) ?? null;
  }
  get ctxIsFile(): boolean {
    return this.ctxFileObj !== null;
  }
  get canPin(): boolean {
    return this.contextMenu !== null && !this.ctxIsFile;
  }
  get ctxIsPinned(): boolean {
    if (!this.contextMenu || this.ctxIsFile) return false;
    return this.bookmarks.isPinned(this.bucket, this.contextMenu.key);
  }

  // ── Loading ──
  loading = $state(false);
  deleting = $state(false);

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
  bookmarks = new BookmarksState();

  // ── Clipboard (cut / copy) ──
  clipboard = $state<ClipboardState | null>(null);

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

  // ────────────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────────────

  constructor(options?: { connected?: boolean; buckets?: string[]; connectionId?: string | null }) {
    if (options?.connected !== undefined) this.connected = options.connected;
    if (options?.buckets) this.buckets = options.buckets;
    if (options?.connectionId !== undefined) this.connectionId = options.connectionId;
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

  setNavigationHandler(fn: NavigateFn): void {
    this._onNavigate = fn;
  }

  setRefreshHandler(fn: () => void): void {
    this._onRefreshNavigate = fn;
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
      const conn = loadConnectionLocally();
      if (!conn) {
        this.loading = false;
        return;
      }
      const connHeader = getConnectionHeader(conn);
      const params = new SvelteURLSearchParams({
        bucket: this.bucket,
        prefix: prefix ?? '',
        pageSize: String(this.pageSize)
      });
      const res = await fetch(`/api/storage/objects?${params}`, {
        headers: { 'x-storage-connection': connHeader }
      });
      if (res.ok) {
        const objects = (await res.json()) as StoragePage;
        this.prefix = prefix;
        this.objects = objects;
      }
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
      const conn = loadConnectionLocally();
      if (!conn) {
        addToast('error', m.storage_download_error_unknown());
        return;
      }
      const connHeader = getConnectionHeader(conn);
      const params = new SvelteURLSearchParams({
        bucket: this.bucket,
        key: this.archiveKey,
        path: internalPath
      });
      if (this.archiveNestedPath) {
        params.set('nestedArchivePath', this.archiveNestedPath);
      }
      const res = await fetch(`/api/storage/archive/extract?${params}`, {
        headers: { 'x-storage-connection': connHeader }
      });
      if (!res.ok) {
        const code =
          res.status === 403 ? 'access_denied' : res.status === 404 ? 'not_found' : 'server_error';
        throw new DownloadError(code, `Extract failed with status ${res.status}`);
      }
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
      if (err instanceof DownloadError) {
        addToast('error', getActionErrorMessage(new ActionError(err.code, err.message)));
      } else {
        addToast('error', m.storage_download_error_unknown());
      }
    }
  };

  /** Fetch archive listing from the server API. */
  private async _fetchArchiveListing(): Promise<void> {
    const conn = loadConnectionLocally();
    if (!conn || !this.archiveKey) {
      this.archiveLoading = false;
      return;
    }
    const connHeader = getConnectionHeader(conn);
    const params = new SvelteURLSearchParams({
      bucket: this.bucket,
      key: this.archiveKey,
      internalPrefix: this.archivePrefix
    });
    if (this.archiveNestedPath) {
      params.set('nestedArchivePath', this.archiveNestedPath);
    }
    const res = await fetch(`/api/storage/archive/listing?${params}`, {
      headers: { 'x-storage-connection': connHeader }
    });
    if (!res.ok) {
      throw new Error(m.storage_archive_open_error());
    }
    const data = (await res.json()) as ArchiveListingResponse;
    if (data.tooLarge) {
      this.archiveTooLarge = true;
      this.archiveLoading = false;
      this.objects = { objects: [], hasNextPage: false, currentPage: 1, pageSize: null as never };
      return;
    }
    this.archiveTooLarge = false;
    const prefix = this.archivePrefix || '';
    this.objects = {
      objects: data.entries.map((e: ArchiveEntry) => ({
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

  closeContextMenu = (): void => {
    if (this.contextMenu) {
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
          const conn = loadConnectionLocally();
          if (!conn) {
            addToast('error', m.storage_download_error_unknown());
            return;
          }
          await downloadObject(this.bucket, key, getConnectionHeader(conn));
        } catch (err: unknown) {
          if (err instanceof DownloadError) {
            addToast('error', getActionErrorMessage(new ActionError(err.code, err.message)));
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
        await navigator.clipboard.writeText(keyToName(nameKey));
        addToast('success', m.storage_action_copy_filename_success());
        return;
      }

      case 'copy-path': {
        const pathKey = ctxKey ?? this.selectedFiles[0]?.key;
        if (!pathKey) return;
        // Strip trailing slash for folders so the URI is canonical.
        const cleanKey = pathKey.endsWith('/') ? pathKey.slice(0, -1) : pathKey;
        await navigator.clipboard.writeText(`s3://${this.bucket}/${cleanKey}`);
        addToast('success', m.storage_action_copy_path_success());
        return;
      }

      case 'cut': {
        if (!storageCutCopyEnabled) return;
        const cutKeys = [...this.selectedKeys];
        if (cutKeys.length === 0) return;
        this.clipboard = { action: 'cut', keys: cutKeys, sourceBucket: this.bucket };
        addToast('info', m.storage_action_cut_success({ count: cutKeys.length }));
        return;
      }

      case 'copy': {
        if (!storageCutCopyEnabled) return;
        const copyKeys = [...this.selectedKeys];
        if (copyKeys.length === 0) return;
        this.clipboard = { action: 'copy', keys: copyKeys, sourceBucket: this.bucket };
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
        const destPrefix = this.prefix;
        try {
          await this.performPaste(pasteKeys, this.clipboard.sourceBucket, destPrefix);
          addToast('success', m.storage_action_paste_success({ count: pasteKeys.length }));
          // After first paste of cut items, switch to copy mode so they
          // can still be pasted again (like a copy action).
          if (wasCut) {
            this.clipboard = { ...this.clipboard, action: 'copy' };
          }
          this.loading = true;
          void invalidateAll();
        } catch (err: unknown) {
          let msg = m.storage_action_paste_error();
          if (err instanceof ActionError) {
            msg = getActionErrorMessage(err);
          }
          addToast('error', msg);
        }
        return;
      }

      case 'rename': {
        if (!storageRenameEnabled) return;
        const renameKey = ctxKey ?? [...this.selectedKeys][0];
        if (!renameKey) return;
        this.openModal('rename', { key: renameKey });
        return;
      }
    }
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
      this.loading = true;
      await invalidateAll();
    } catch (err: unknown) {
      this.loading = false;
      let msg = m.storage_delete_error_unknown();
      if (err instanceof ActionError) {
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
    this.loading = true;
    void invalidateAll();
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Paste implementation
  // ────────────────────────────────────────────────────────────────────────────

  private async performPaste(
    keys: string[],
    _sourceBucket: string,
    destPrefix: string
  ): Promise<void> {
    const conn = loadConnectionLocally();
    if (!conn) throw new ActionError('not_connected', 'No connection');

    const params = new SvelteURLSearchParams({ bucket: this.bucket });
    const res = await fetch(`/api/storage/copy?${params}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-storage-connection': getConnectionHeader(conn)
      },
      body: JSON.stringify({
        sourceKeys: keys,
        destinationPrefix: destPrefix
      })
    });

    if (!res.ok) {
      let code = 'server_error';
      if (res.status === 401) code = 'not_connected';
      else if (res.status === 403) code = 'access_denied';
      throw new ActionError(code, `Paste failed with status ${res.status}`);
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Rename
  // ────────────────────────────────────────────────────────────────────────────

  confirmRename = async (key: string, newName: string): Promise<void> => {
    this.closeModal();

    if (!newName.trim()) return;

    const parts = key.split('/');
    parts.pop();
    const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    const newKey = parentPrefix + newName + (key.endsWith('/') ? '/' : '');

    if (newKey === key) return;

    try {
      const conn = loadConnectionLocally();
      if (!conn) {
        addToast('error', m.storage_rename_error_not_connected());
        return;
      }

      const res = await fetch('/api/storage/rename', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-storage-connection': getConnectionHeader(conn)
        },
        body: JSON.stringify({ bucket: this.bucket, key, newKey })
      });

      if (!res.ok) {
        let msg = m.storage_rename_error({ name: newName });
        if (res.status === 403) msg = m.storage_rename_error_access_denied();
        else if (res.status === 404) msg = m.storage_rename_error_not_found();
        addToast('error', msg);
        return;
      }

      addToast('success', m.storage_rename_success({ name: newName }));
      this.loading = true;
      void invalidateAll();
    } catch {
      addToast('error', m.storage_rename_error({ name: newName }));
    }
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Move (used by drag-and-drop)
  // ────────────────────────────────────────────────────────────────────────────

  /** Move the currently selected items (or given keys) to a destination prefix.
   *  The items are copied to the destination and then deleted from the source. */
  performMove = async (destPrefix: string, keys?: string[]): Promise<void> => {
    const moveKeys = keys ?? [...this.selectedKeys];
    if (moveKeys.length === 0) return;

    // Don't move to the same prefix
    if (destPrefix === this.prefix) return;

    // Don't move a folder into itself
    for (const k of moveKeys) {
      if (k.endsWith('/') && destPrefix.startsWith(k)) return;
    }

    try {
      const conn = loadConnectionLocally();
      if (!conn) {
        addToast('error', m.storage_action_move_error_not_connected());
        return;
      }

      const params = new SvelteURLSearchParams({ bucket: this.bucket });
      const res = await fetch(`/api/storage/move?${params}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-storage-connection': getConnectionHeader(conn)
        },
        body: JSON.stringify({
          sourceKeys: moveKeys,
          destinationPrefix: destPrefix
        })
      });

      if (!res.ok) {
        let msg = m.storage_action_move_error();
        if (res.status === 403) msg = m.storage_action_move_error_access_denied();
        addToast('error', msg);
        return;
      }

      const result = (await res.json()) as {
        moved: Array<{ sourceKey: string; destKey: string }>;
        failed: Array<{ sourceKey: string; error: string }>;
      };

      if (result.moved.length > 0) {
        addToast('success', m.storage_action_move_success({ count: result.moved.length }));
      }
      if (result.failed.length > 0) {
        addToast('warning', m.storage_action_move_partial({ count: result.failed.length }));
      }

      this.selectedKeys = new SvelteSet<string>();
      this.selectionMode = false;
      this.loading = true;
      void invalidateAll();
    } catch {
      addToast('error', m.storage_action_move_error());
    }
  };

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
  // Private: Delete implementation
  // ────────────────────────────────────────────────────────────────────────────

  private async performDelete(
    bucket: string,
    keys: string[]
  ): Promise<{ failed: Array<{ key: string; code?: string; message?: string }> }> {
    const params = new SvelteURLSearchParams({ bucket });
    for (const key of keys) params.append('keys', key);

    const conn = loadConnectionLocally();
    const headers: HeadersInit = conn ? { 'x-storage-connection': getConnectionHeader(conn) } : {};

    const res = await fetch(`/api/storage/delete?${params}`, { method: 'DELETE', headers });
    if (!res.ok) {
      let code: string;
      if (res.status === 401) code = 'not_connected';
      else if (res.status === 403) code = 'access_denied';
      else if (res.status >= 500) code = 'server_error';
      else code = 'unknown';
      throw new ActionError(code, `Delete failed with status ${res.status}`);
    }

    const result = (await res.json()) as {
      failed: Array<{ key: string; code?: string; message?: string }>;
    };

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

    return result;
  }
}
