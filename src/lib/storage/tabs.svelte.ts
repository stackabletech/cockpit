import { browser } from '$app/environment';
import type { StoragePage } from '$lib/storage/types.js';
import type { PageSize } from '$lib/types/pagination.js';
import type { StorageState } from './state.svelte.js';
import { LS_TABS } from './persistence.js';
import { keyToName } from './utils.js';

// ── Tab data ─────────────────────────────────────────────────────────────────

export interface TabSnapshot {
  bucket: string;
  prefix: string;
  objects: StoragePage;
  prevTokens: (string | null)[];
  pageSize: PageSize;
  archiveKey: string | null;
  archivePrefix: string;
  archiveNestedPath: string | null;
  previousS3Prefix: string;
  archiveLoading: boolean;
  archiveTooLarge: boolean;
  /** Pre-computed auto-generated label for this snapshot (used by syncActiveTab
   *  to decide whether the label was manually renamed). */
  autoLabel: string;
}

export interface Tab {
  id: string;
  label: string;
  /** True when this tab was restored from persistence and has not yet loaded
   *  fresh data. Switching to a stub triggers a full navigation instead of a
   *  snapshot restore. */
  stub: boolean;
  snapshot: TabSnapshot;
}

// ── Persistence schema ────────────────────────────────────────────────────────

export interface PersistedTab {
  id: string;
  label: string;
  bucket: string;
  prefix: string;
}

export interface PersistedTabsState {
  tabs: PersistedTab[];
  activeTabId: string;
  /** Fingerprint of the connection that saved these tabs.
   *  Absent in data saved before this field was introduced (treated as a match
   *  for any connection to preserve backward compatibility). */
  connectionId?: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

const EMPTY_PAGE: StoragePage = { objects: [], hasNextPage: false, currentPage: 1, pageSize: 25 };

// ── Tabs state ───────────────────────────────────────────────────────────────

export class TabsState {
  tabs = $state<Tab[]>([]);
  activeTabId = $state<string | null>(null);

  private storage: StorageState;
  private persistEnabled: boolean;
  private connectionId: string | null;
  private navigateToLocation: ((bucket: string, prefix: string) => void) | null;
  private replaceLocationUrl: ((bucket: string, prefix: string) => void) | null;

  get hasTabs(): boolean {
    return this.tabs.length > 1;
  }

  constructor(
    storage: StorageState,
    options?: {
      persistEnabled?: boolean;
      connectionId?: string | null;
      navigateToLocation?: (bucket: string, prefix: string) => void;
      replaceLocationUrl?: (bucket: string, prefix: string) => void;
    }
  ) {
    this.storage = storage;
    this.persistEnabled = options?.persistEnabled ?? false;
    this.connectionId = options?.connectionId ?? null;
    this.navigateToLocation = options?.navigateToLocation ?? null;
    this.replaceLocationUrl = options?.replaceLocationUrl ?? null;
  }

  // ── Snapshot helpers ─────────────────────────────────────────────────────

  private captureSnapshot(): TabSnapshot {
    return {
      bucket: this.storage.bucket,
      prefix: this.storage.prefix,
      objects: this.storage.objects,
      prevTokens: [...this.storage.prevTokens],
      pageSize: this.storage.pageSize,
      archiveKey: this.storage.archive.archiveKey,
      archivePrefix: this.storage.archive.archivePrefix,
      archiveNestedPath: this.storage.archive.nestedArchivePath ?? null,
      previousS3Prefix: this.storage.archive._previousS3Prefix,
      archiveLoading: this.storage.archive.archiveLoading,
      archiveTooLarge: this.storage.archive.archiveTooLarge,
      autoLabel: this.computeAutoLabel()
    };
  }

  private computeAutoLabel(): string {
    if (this.storage.archive.isInArchive && this.storage.archive.archiveKey) {
      return this.archiveLabelFrom(
        this.storage.archive.archiveKey,
        this.storage.archive.archivePrefix,
        this.storage.archive.nestedArchivePath ?? null
      );
    }
    return this.buildLabel(this.storage.bucket, this.storage.prefix);
  }

  private restoreSnapshot(snapshot: TabSnapshot): void {
    this.storage.bucket = snapshot.bucket;
    this.storage.prefix = snapshot.prefix;
    this.storage.objects = snapshot.objects;
    this.storage.prevTokens = [...snapshot.prevTokens];
    this.storage.pageSize = snapshot.pageSize;
    this.storage.archive._restoreFullState({
      archiveKey: snapshot.archiveKey,
      archivePrefix: snapshot.archivePrefix,
      archiveNestedPath: snapshot.archiveNestedPath,
      previousS3Prefix: snapshot.previousS3Prefix,
      archiveLoading: snapshot.archiveLoading,
      archiveTooLarge: snapshot.archiveTooLarge
    });
    this.storage.loading = false;
    this.storage.clearSelection();
    this.replaceLocationUrl?.(snapshot.bucket, snapshot.prefix);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private saveToPersistence(): void {
    if (!this.persistEnabled || !browser) return;
    const data: PersistedTabsState = {
      tabs: this.tabs.map((t) => ({
        id: t.id,
        label: t.label,
        bucket: t.snapshot.bucket,
        prefix: t.snapshot.prefix
      })),
      activeTabId: this.activeTabId ?? '',
      connectionId: this.connectionId ?? undefined
    };
    localStorage.setItem(LS_TABS, JSON.stringify(data));
  }

  /** Reads persisted tab state from localStorage without modifying any state.
   *  Returns null if nothing is saved, persistence is disabled, or the saved
   *  state belongs to a different connection. */
  peekPersistedTabs(): PersistedTabsState | null {
    if (!this.persistEnabled || !browser) return null;
    try {
      const raw = localStorage.getItem(LS_TABS);
      if (!raw) return null;
      const data = JSON.parse(raw) as PersistedTabsState;
      if (!Array.isArray(data.tabs) || data.tabs.length === 0) return null;
      // If both sides have a connectionId and they don't match, this save belongs
      // to a different connection — do not offer restore.
      if (data.connectionId && this.connectionId && data.connectionId !== this.connectionId) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /** Restores tabs from a previously peeked snapshot. Creates stub tabs for
   *  all locations and navigates to the active one. Each tab gets a fresh UUID
   *  to guarantee no key collisions with concurrently created tabs. */
  restorePersistedTabs(saved: PersistedTabsState): void {
    // Generate a fresh UUID per tab slot so that any duplicate IDs that may
    // exist in older persisted data (from the previous counter-based scheme)
    // never collide in the rendered each block.
    const activeIdx = saved.tabs.findIndex((pt) => pt.id === saved.activeTabId);

    this.tabs = saved.tabs.map((pt) => ({
      id: crypto.randomUUID(),
      label: pt.label,
      stub: true,
      snapshot: {
        bucket: pt.bucket,
        prefix: pt.prefix,
        objects: EMPTY_PAGE,
        prevTokens: [],
        pageSize: this.storage.pageSize,
        archiveKey: null,
        archivePrefix: '',
        archiveNestedPath: null,
        previousS3Prefix: '',
        archiveLoading: false,
        archiveTooLarge: false,
        autoLabel: pt.label
      }
    }));

    // eslint-disable-next-line security/detect-object-injection
    const mappedActiveId = activeIdx >= 0 ? this.tabs[activeIdx].id : this.tabs[0].id;
    this.activeTabId = mappedActiveId;

    // Persist immediately with the new UUIDs so the banner won't re-offer on
    // the next visit to /storage.
    this.saveToPersistence();

    const activeTab = this.tabs.find((t) => t.id === mappedActiveId)!;

    if (
      this.storage.bucket === activeTab.snapshot.bucket &&
      this.storage.prefix === activeTab.snapshot.prefix
    ) {
      this.markActiveTabLoaded();
    } else if (this.navigateToLocation) {
      this.navigateToLocation(activeTab.snapshot.bucket, activeTab.snapshot.prefix);
    } else {
      this.markActiveTabLoaded();
    }
  }

  /** Removes the persisted tabs entry from localStorage. */
  clearPersistedTabs(): void {
    if (browser) localStorage.removeItem(LS_TABS);
  }

  // ── Tab operations ───────────────────────────────────────────────────────

  /** Initialises tabs from the current storage state. If persistence is
   *  enabled, restores tabs from localStorage (handles both SPA navigation
   *  via the /storage banner flag and full page reloads).
   *
   *  Tabs are only restored when the current storage bucket/prefix matches
   *  the saved active tab's location — otherwise the user navigated to a
   *  different location directly and stale tabs should not override it. */
  ensureInitialTab(): void {
    if (this.tabs.length > 0) return;

    if (this.persistEnabled) {
      const saved = this.peekPersistedTabs();
      if (saved && saved.tabs.length > 0) {
        const activeIdx = saved.tabs.findIndex((pt) => pt.id === saved.activeTabId);
        const activeTab = activeIdx >= 0 ? saved.tabs[activeIdx] : saved.tabs[0];
        if (
          activeTab &&
          this.storage.bucket === activeTab.bucket &&
          this.storage.prefix === activeTab.prefix
        ) {
          this.restorePersistedTabs(saved);
          return;
        }
        this.clearPersistedTabs();
      }
    }

    const id = crypto.randomUUID();
    const label = this.computeAutoLabel();
    this.tabs = [{ id, label, stub: false, snapshot: this.captureSnapshot() }];
    this.activeTabId = id;
    this.saveToPersistence();
  }

  /** Marks the active tab as loaded with current storage data (clears stub). */
  markActiveTabLoaded(): void {
    if (!this.activeTabId) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (idx === -1) return;
    // eslint-disable-next-line security/detect-object-injection
    const tab = this.tabs[idx];
    if (!tab.stub) return;
    this.tabs = [
      ...this.tabs.slice(0, idx),
      { ...tab, stub: false, snapshot: this.captureSnapshot() },
      ...this.tabs.slice(idx + 1)
    ];
  }

  /** Updates the active tab's snapshot to reflect current storage state. */
  syncActiveTab(): void {
    if (!this.activeTabId) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (idx === -1) return;
    // eslint-disable-next-line security/detect-object-injection
    const tab = this.tabs[idx];
    const updatedTab: Tab = {
      ...tab,
      stub: false,
      snapshot: this.captureSnapshot(),
      label: tab.label === tab.snapshot.autoLabel ? this.computeAutoLabel() : tab.label
    };
    this.tabs = [...this.tabs.slice(0, idx), updatedTab, ...this.tabs.slice(idx + 1)];
    this.saveToPersistence();
  }

  /** Adds a new tab at the current location and switches to it. */
  addTab(): void {
    this.syncActiveTab();
    const id = crypto.randomUUID();
    const label = this.computeAutoLabel();
    const newTab: Tab = { id, label, stub: false, snapshot: this.captureSnapshot() };
    this.tabs = [...this.tabs, newTab];
    this.activeTabId = id;
    this.saveToPersistence();
  }

  /** Switches to a tab by id. Stub tabs trigger a navigation to load fresh data. */
  switchTo(id: string): void {
    if (id === this.activeTabId) return;
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.syncActiveTab();
    this.activeTabId = id;
    this.saveToPersistence();

    if (tab.stub && this.navigateToLocation) {
      this.navigateToLocation(tab.snapshot.bucket, tab.snapshot.prefix);
    } else {
      this.restoreSnapshot(tab.snapshot);
    }
  }

  /** Closes a tab by id. If it's the active tab, switches to an adjacent one. */
  closeTab(id: string): void {
    if (this.tabs.length <= 1) return;
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;

    const newTabs = this.tabs.filter((t) => t.id !== id);
    this.tabs = newTabs;

    if (id === this.activeTabId) {
      const newIdx = Math.min(idx, newTabs.length - 1);
      // eslint-disable-next-line security/detect-object-injection
      const nextTab = newTabs[newIdx];
      this.activeTabId = nextTab.id;
      if (nextTab.stub && this.navigateToLocation) {
        this.navigateToLocation(nextTab.snapshot.bucket, nextTab.snapshot.prefix);
      } else {
        this.restoreSnapshot(nextTab.snapshot);
      }
    }

    this.saveToPersistence();
  }

  /** Renames a tab. */
  renameTab(id: string, newLabel: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    // eslint-disable-next-line security/detect-object-injection
    const tab = this.tabs[idx];
    this.tabs = [
      ...this.tabs.slice(0, idx),
      { ...tab, label: newLabel },
      ...this.tabs.slice(idx + 1)
    ];
    this.saveToPersistence();
  }

  /** Reorders tabs by moving from one index to another. */
  reorderTabs(fromIdx: number, toIdx: number): void {
    if (fromIdx === toIdx) return;
    const copy = [...this.tabs];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    this.tabs = copy;
    this.saveToPersistence();
  }

  /** Marks all non-active tabs whose snapshot prefix matches the given prefix
   *  as stubs so that switching to them triggers a fresh server fetch. Called
   *  after file operations (move, delete, rename) that change a directory's
   *  contents. */
  setStalePrefix(prefix: string): void {
    let changed = false;
    const next = this.tabs.map((tab) => {
      if (tab.id === this.activeTabId) return tab;
      if (tab.snapshot.prefix === prefix && !tab.stub) {
        changed = true;
        return { ...tab, stub: true };
      }
      return tab;
    });
    if (changed) {
      this.tabs = next;
      this.saveToPersistence();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildLabel(bucket: string, prefix: string): string {
    if (!prefix) return bucket;
    const parts = prefix.replace(/\/$/, '').split('/');
    return parts[parts.length - 1];
  }

  private archiveLabelFrom(
    archiveKey: string | null,
    archivePrefix: string,
    archiveNestedPath: string | null
  ): string {
    if (archivePrefix) {
      const parts = archivePrefix.replace(/\/$/, '').split('/');
      return parts[parts.length - 1];
    }
    if (archiveNestedPath) {
      return keyToName(archiveNestedPath);
    }
    if (archiveKey) {
      return keyToName(archiveKey);
    }
    return '';
  }
}
