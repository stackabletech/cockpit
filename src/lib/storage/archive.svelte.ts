import { invalidateAll } from '$app/navigation';
import * as m from '$lib/paraglide/messages.js';
import { addToast } from '$lib/stores/toast.svelte.js';
import { ARCHIVE_EXTENSIONS } from '$lib/storage/types.js';
import { StorageError, getActionErrorMessage } from './errors.js';
import type { StoragePage } from '$lib/storage/types.js';
import type { StorageApi } from './api.js';

// ── ArchiveState ───────────────────────────────────────────────────────────

export class ArchiveState {
  // ── Reactive state (readable by UI components) ─────────────────────────
  archiveKey = $state<string | null>(null);
  /** Virtual path prefix within the archive ('' = root). */
  archivePrefix = $state('');
  archiveLoading = $state(false);
  archiveTooLarge = $state(false);
  isInArchive = $derived(this.archiveKey !== null);

  /** Internal archive nested path, exposed via getter for access control. */
  private _archiveNestedPath = $state<string | null>(null);

  get nestedArchivePath(): string | undefined {
    return this._archiveNestedPath ?? undefined;
  }

  /**
   * S3 prefix we were at before entering the archive.
   * Internal field — read via `archive.archivePrefix` stack.
   * Set from snapshot by `_restoreFullState`.
   */
  _previousS3Prefix = $state('');

  // ── Dependencies ───────────────────────────────────────────────────────

  private _api: StorageApi;

  /** Callbacks to mutate StorageState fields without coupling directly. */
  private _callbacks: {
    getBucket: () => string;
    getPrefix: () => string;
    getPageSize: () => number;
    setObjects: (objects: StoragePage) => void;
    setLoading: (loading: boolean) => void;
    setPrefix: (prefix: string) => void;
    clearPrevTokens: () => void;
    /** Called when the user exits archive — StorageState should navigate to S3. */
    onExit: (s3Prefix: string) => void;
  };

  constructor(
    api: StorageApi,
    callbacks: {
      getBucket: () => string;
      getPrefix: () => string;
      getPageSize: () => number;
      setObjects: (objects: StoragePage) => void;
      setLoading: (loading: boolean) => void;
      setPrefix: (prefix: string) => void;
      clearPrevTokens: () => void;
      onExit: (s3Prefix: string) => void;
    }
  ) {
    this._api = api;
    this._callbacks = callbacks;
  }

  // ── Public methods ─────────────────────────────────────────────────────

  /** Check if a filename looks like a navigable archive. */
  isArchiveFile(key: string): boolean {
    const lower = key.toLowerCase();
    return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  /** Enter an archive file and show its contents as a virtual folder. */
  async enterArchive(archiveKey: string): Promise<void> {
    if (this.isInArchive) {
      this._archiveNestedPath = archiveKey;
    } else {
      this.archiveKey = archiveKey;
      this._archiveNestedPath = null;
      this._previousS3Prefix = this._callbacks.getPrefix();
    }
    this.archivePrefix = '';
    this.archiveLoading = true;

    try {
      await this._fetchArchiveListing();
    } catch (err) {
      if (this._archiveNestedPath) {
        this._archiveNestedPath = null;
      } else {
        this.archiveKey = null;
        this._previousS3Prefix = '';
      }
      this.archivePrefix = '';
      this.archiveLoading = false;
      addToast('error', err instanceof Error ? err.message : m.storage_archive_open_error());
    }
  }

  /** Navigate within the current archive (virtual path). */
  async navigateInArchive(prefix: string): Promise<void> {
    if (!this.archiveKey) return;
    this.archivePrefix = prefix;
    this.archiveLoading = true;
    this._callbacks.clearPrevTokens();

    try {
      await this._fetchArchiveListing();
    } catch (err) {
      this.archiveLoading = false;
      addToast('error', err instanceof Error ? err.message : m.storage_archive_open_error());
    }
  }

  /** Navigate to the root of the outermost archive (clears nested archive state). */
  navigateToOuterArchiveRoot = (): void => {
    this._archiveNestedPath = null;
    this.archivePrefix = '';
    this.archiveLoading = true;
    this._callbacks.clearPrevTokens();
    void this._fetchArchiveListing().catch(() => {
      this.archiveLoading = false;
    });
  };

  /** Navigate up within the archive. If at root, exit the archive or go to parent archive. */
  navigateUpFromArchive = (): void => {
    if (!this.archivePrefix) {
      if (this._archiveNestedPath) {
        // Go back to outer archive root
        this._archiveNestedPath = null;
        this.archivePrefix = '';
        this.archiveLoading = true;
        this._callbacks.clearPrevTokens();
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
    const s3Prefix = this._previousS3Prefix;
    this.reset();
    this._callbacks.onExit(s3Prefix);
  };

  /** Download a file from within the current archive. */
  async downloadFromArchive(internalPath: string): Promise<void> {
    if (!this.archiveKey) return;
    try {
      const res = await this._api.archiveExtract({
        bucket: this._callbacks.getBucket(),
        key: this.archiveKey,
        path: internalPath,
        nestedArchivePath: this._archiveNestedPath ?? undefined
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
  }

  /** Re-fetch the archive listing. Only call when isInArchive is true. */
  refreshListing = (): void => {
    this.archiveLoading = true;
    void this._fetchArchiveListing().catch(() => {
      this.archiveLoading = false;
    });
  };

  /** Clear all archive state (called from StorageState.syncFromServer). */
  reset = (): void => {
    this.archiveKey = null;
    this.archivePrefix = '';
    this._archiveNestedPath = null;
    this._previousS3Prefix = '';
    this.archiveLoading = false;
    this.archiveTooLarge = false;
  };

  // ── Internal methods ──────────────────────────────────────────────────

  /**
   * Restore full archive state from a tab snapshot. For use by TabsState only.
   * Directly sets internal fields including private ones.
   */
  _restoreFullState(params: {
    archiveKey: string | null;
    archivePrefix: string;
    archiveNestedPath: string | null;
    previousS3Prefix: string;
    archiveLoading: boolean;
    archiveTooLarge: boolean;
  }): void {
    this.archiveKey = params.archiveKey;
    this.archivePrefix = params.archivePrefix;
    this._archiveNestedPath = params.archiveNestedPath;
    this._previousS3Prefix = params.previousS3Prefix;
    this.archiveLoading = params.archiveLoading;
    this.archiveTooLarge = params.archiveTooLarge;
  }

  /**
   * Fetch S3 objects for the given prefix (used when exiting archive).
   * This is called from StorageState's onExit callback.
   */
  async _fetchS3Objects(prefix: string): Promise<void> {
    try {
      const objects = await this._api.list({
        bucket: this._callbacks.getBucket(),
        prefix: prefix ?? '',
        pageSize: this._callbacks.getPageSize()
      });
      this._callbacks.setPrefix(prefix);
      this._callbacks.setObjects(objects);
    } catch {
      // Fall back to invalidateAll if manual fetch fails
      void invalidateAll();
    } finally {
      this._callbacks.setLoading(false);
    }
  }

  /** Fetch archive listing from the server API. */
  private async _fetchArchiveListing(): Promise<void> {
    if (!this.archiveKey) {
      this.archiveLoading = false;
      return;
    }
    const data = await this._api.archiveListing({
      bucket: this._callbacks.getBucket(),
      key: this.archiveKey,
      internalPrefix: this.archivePrefix,
      nestedArchivePath: this._archiveNestedPath ?? undefined
    });
    if (data.tooLarge) {
      this.archiveTooLarge = true;
      this.archiveLoading = false;
      this._callbacks.setObjects({
        objects: [],
        hasNextPage: false,
        currentPage: 1,
        pageSize: null as never
      });
      return;
    }
    this.archiveTooLarge = false;
    const prefix = this.archivePrefix || '';
    this._callbacks.setObjects({
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
    });
    this.archiveLoading = false;
  }
}
