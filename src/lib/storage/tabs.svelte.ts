import type { StoragePage } from '$lib/storage/types.js';
import type { PageSize } from '$lib/types/pagination.js';
import type { StorageState } from './state.svelte.js';

// ── Tab data ─────────────────────────────────────────────────────────────────

export interface TabSnapshot {
  bucket: string;
  prefix: string;
  objects: StoragePage;
  prevTokens: (string | null)[];
  pageSize: PageSize;
}

export interface Tab {
  id: string;
  label: string;
  snapshot: TabSnapshot;
}

// ── Tabs state ───────────────────────────────────────────────────────────────

let nextId = 1;

function generateTabId(): string {
  return `tab-${nextId++}`;
}

export class TabsState {
  tabs = $state<Tab[]>([]);
  activeTabId = $state<string | null>(null);

  private storage: StorageState;

  get hasTabs(): boolean {
    return this.tabs.length > 1;
  }

  constructor(storage: StorageState) {
    this.storage = storage;
  }

  // ── Snapshot helpers ─────────────────────────────────────────────────────

  private captureSnapshot(): TabSnapshot {
    return {
      bucket: this.storage.bucket,
      prefix: this.storage.prefix,
      objects: this.storage.objects,
      prevTokens: [...this.storage.prevTokens],
      pageSize: this.storage.pageSize
    };
  }

  private restoreSnapshot(snapshot: TabSnapshot): void {
    this.storage.bucket = snapshot.bucket;
    this.storage.prefix = snapshot.prefix;
    this.storage.objects = snapshot.objects;
    this.storage.prevTokens = [...snapshot.prevTokens];
    this.storage.pageSize = snapshot.pageSize;
    this.storage.loading = false;
    // Clear selection when switching tabs
    this.storage.clearSelection();
  }

  // ── Tab operations ───────────────────────────────────────────────────────

  /** Initialises the first tab from the current storage state (called once). */
  ensureInitialTab(): void {
    if (this.tabs.length === 0) {
      const id = generateTabId();
      const label = this.buildLabel(this.storage.bucket, this.storage.prefix);
      this.tabs = [{ id, label, snapshot: this.captureSnapshot() }];
      this.activeTabId = id;
    }
  }

  /** Updates the active tab's snapshot to reflect current storage state. */
  syncActiveTab(): void {
    if (!this.activeTabId) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    if (idx === -1) return;
    const tab = this.tabs[idx];
    const updatedTab = {
      ...tab,
      snapshot: this.captureSnapshot(),
      label:
        tab.label === this.buildLabel(tab.snapshot.bucket, tab.snapshot.prefix)
          ? this.buildLabel(this.storage.bucket, this.storage.prefix)
          : tab.label
    };
    this.tabs = [...this.tabs.slice(0, idx), updatedTab, ...this.tabs.slice(idx + 1)];
  }

  /** Adds a new tab at the current location and switches to it. */
  addTab(): void {
    this.syncActiveTab();
    const id = generateTabId();
    const label = this.buildLabel(this.storage.bucket, this.storage.prefix);
    const newTab: Tab = { id, label, snapshot: this.captureSnapshot() };
    this.tabs = [...this.tabs, newTab];
    this.activeTabId = id;
  }

  /** Switches to a tab by id. */
  switchTo(id: string): void {
    if (id === this.activeTabId) return;
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.syncActiveTab();
    this.activeTabId = id;
    this.restoreSnapshot(tab.snapshot);
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
      this.activeTabId = newTabs[newIdx].id;
      this.restoreSnapshot(newTabs[newIdx].snapshot);
    }
  }

  /** Renames a tab. */
  renameTab(id: string, newLabel: string): void {
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const tab = this.tabs[idx];
    this.tabs = [
      ...this.tabs.slice(0, idx),
      { ...tab, label: newLabel },
      ...this.tabs.slice(idx + 1)
    ];
  }

  /** Reorders tabs by moving from one index to another. */
  reorderTabs(fromIdx: number, toIdx: number): void {
    if (fromIdx === toIdx) return;
    const copy = [...this.tabs];
    const [moved] = copy.splice(fromIdx, 1);
    copy.splice(toIdx, 0, moved);
    this.tabs = copy;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private buildLabel(bucket: string, prefix: string): string {
    if (!prefix) return bucket;
    const parts = prefix.replace(/\/$/, '').split('/');
    return parts[parts.length - 1];
  }
}
