import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { TabState } from './tab-store.svelte.js';

vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('$lib/paraglide/messages.js', () => ({ trino_tab_default_name: () => 'Query' }));

interface TabStoreApi {
  tabs: TabState[];
  activeTabId: string;
  activeTab: TabState;
  maxTabs: number;
  persistError: boolean;
  createTab: () => TabState | null;
  closeTab: (id: string) => void;
  switchTab: (id: string) => void;
  reorderTabs: (fromIndex: number, toIndex: number) => void;
  updateSql: (id: string, sql: string) => void;
  renameTab: (id: string, label: string | null) => void;
  getTabLabel: (tab: TabState) => string;
}

let store: TabStoreApi;
let uuidCounter = 0;

function resetStore() {
  localStorage.clear();
  while (store.tabs.length > 1) {
    store.closeTab(store.tabs[store.tabs.length - 1].id);
  }
  if (store.tabs.length === 1) {
    store.updateSql(store.tabs[0].id, 'SELECT 1');
    store.renameTab(store.tabs[0].id, null);
  }
}

function makeCryptoStub() {
  return { randomUUID: () => `uuid-${++uuidCounter}` };
}

beforeEach(async () => {
  vi.stubGlobal('crypto', makeCryptoStub());

  if (!store) {
    vi.resetModules();
    const mod = await import('./tab-store.svelte.js');
    store = mod.tabStore as unknown as TabStoreApi;
  } else {
    resetStore();
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Clean up after tests that create 8 tabs (maxTabs).
  while (store.tabs.length > 1) {
    store.closeTab(store.tabs[store.tabs.length - 1].id);
  }
});

describe('tab-store', () => {
  it('creates a default tab with SELECT 1', () => {
    expect(store.tabs.length).toBe(1);
    expect(store.tabs[0].sql).toBe('SELECT 1');
    expect(store.tabs[0].label).toBeNull();
  });

  it('sets activeTabId to the default tab', () => {
    expect(store.activeTabId).toBe(store.tabs[0].id);
  });

  it('derives activeTab from activeTabId', () => {
    expect(store.activeTab).toBe(store.tabs[0]);
  });

  it('createTab adds a new tab and switches to it', () => {
    const tab = store.createTab();
    expect(tab).not.toBeNull();
    expect(store.tabs.length).toBe(2);
    expect(store.activeTabId).toBe(tab!.id);
  });

  it('createTab returns null when max tabs reached', () => {
    for (let i = 1; i < store.maxTabs; i++) {
      store.createTab();
    }
    expect(store.createTab()).toBeNull();
    expect(store.tabs.length).toBe(store.maxTabs);
    // Clean up to 1 tab so subsequent tests don't inherit max state.
    while (store.tabs.length > 1) {
      store.closeTab(store.tabs[store.tabs.length - 1].id);
    }
  });

  it('closeTab removes a non-active tab without switching', () => {
    expect(store.tabs.length).toBe(1);
    const originalId = store.tabs[0].id;
    store.createTab();
    expect(store.tabs.length).toBe(2);
    const activeBefore = store.activeTabId;
    store.closeTab(originalId);
    expect(store.tabs.find((t) => t.id === originalId)).toBeUndefined();
    expect(store.activeTabId).toBe(activeBefore);
  });

  it('closeTab switches to adjacent tab when closing active', () => {
    store.createTab();
    store.createTab();
    store.switchTab(store.tabs[1].id);
    store.closeTab(store.tabs[1].id);
    expect(store.tabs.length).toBe(2);
    expect(store.tabs.some((t) => t.id === store.activeTabId)).toBe(true);
  });

  it('does not close the last remaining tab', () => {
    const tabId = store.tabs[0].id;
    store.closeTab(tabId);
    expect(store.tabs.length).toBe(1);
    expect(store.tabs[0].id).toBe(tabId);
  });

  it('closeTab with unknown id is a no-op', () => {
    store.closeTab('non-existent');
    expect(store.tabs.length).toBe(1);
  });

  it('switchTab changes active tab', () => {
    store.createTab();
    store.createTab();
    const targetId = store.tabs[0].id;
    store.switchTab(targetId);
    expect(store.activeTabId).toBe(targetId);
  });

  it('switchTab ignores unknown id', () => {
    const current = store.activeTabId;
    store.switchTab('non-existent');
    expect(store.activeTabId).toBe(current);
  });

  it('reorderTabs moves a tab backward', () => {
    store.createTab();
    store.createTab();
    const idsBefore = store.tabs.map((t) => t.id);
    store.reorderTabs(0, 2);
    const idsAfter = store.tabs.map((t) => t.id);
    expect(idsAfter[0]).toBe(idsBefore[1]);
    expect(idsAfter[1]).toBe(idsBefore[2]);
    expect(idsAfter[2]).toBe(idsBefore[0]);
  });

  it('reorderTabs moves a tab forward', () => {
    store.createTab();
    store.createTab();
    const idsBefore = store.tabs.map((t) => t.id);
    store.reorderTabs(2, 0);
    const idsAfter = store.tabs.map((t) => t.id);
    expect(idsAfter[0]).toBe(idsBefore[2]);
    expect(idsAfter[1]).toBe(idsBefore[0]);
    expect(idsAfter[2]).toBe(idsBefore[1]);
  });

  it('reorderTabs same index is no-op', () => {
    store.createTab();
    const idsBefore = store.tabs.map((t) => t.id);
    store.reorderTabs(1, 1);
    expect(store.tabs.map((t) => t.id)).toEqual(idsBefore);
  });

  it('reorderTabs out of bounds is no-op', () => {
    const idsBefore = store.tabs.map((t) => t.id);
    store.reorderTabs(-1, 0);
    expect(store.tabs.map((t) => t.id)).toEqual(idsBefore);
  });

  it('updateSql updates sql immediately', () => {
    store.updateSql(store.tabs[0].id, 'SELECT 2');
    expect(store.tabs[0].sql).toBe('SELECT 2');
  });

  it('updateSql clamps to MAX_SQL_LENGTH', () => {
    const longSql = 'x'.repeat(300_000);
    store.updateSql(store.tabs[0].id, longSql);
    expect(store.tabs[0].sql.length).toBe(250_000);
  });

  it('updateSql ignores unknown tab id', () => {
    store.updateSql('non-existent', 'SELECT 2');
    expect(store.tabs[0].sql).toBe('SELECT 1');
  });

  it('renameTab sets a custom label', () => {
    store.renameTab(store.tabs[0].id, 'My Query');
    expect(store.tabs[0].label).toBe('My Query');
  });

  it('renameTab with empty string clears label to null', () => {
    store.renameTab(store.tabs[0].id, 'My Query');
    store.renameTab(store.tabs[0].id, '');
    expect(store.tabs[0].label).toBeNull();
  });

  it('renameTab with whitespace clears label to null', () => {
    store.renameTab(store.tabs[0].id, '  ');
    expect(store.tabs[0].label).toBeNull();
  });

  it('getTabLabel returns custom label when set', () => {
    store.renameTab(store.tabs[0].id, 'Custom');
    expect(store.getTabLabel(store.tabs[0])).toBe('Custom');
  });

  it('getTabLabel returns paraglide default when label is null', () => {
    expect(store.getTabLabel(store.tabs[0])).toBe('Query');
  });

  it('persistError is false after normal operations', () => {
    store.createTab();
    store.updateSql(store.tabs[0].id, 'SELECT 2');
    expect(store.persistError).toBe(false);
  });

  it('persists tabs index to localStorage on create', () => {
    store.createTab();
    const raw = localStorage.getItem('trino_tabs_index');
    expect(raw).not.toBeNull();
    const index = JSON.parse(raw!);
    expect(Array.isArray(index.tabs)).toBe(true);
    expect(index.tabs.length).toBe(2);
  });

  it('persists tab SQL to localStorage after debounce', async () => {
    const key = `trino_tab_${store.tabs[0].id}`;
    store.updateSql(store.tabs[0].id, 'SELECT 999');
    await new Promise((r) => setTimeout(r, 600));
    expect(localStorage.getItem(key)).toBe('SELECT 999');
  });

  it('stores a complete index entry in localStorage after operations', () => {
    const tab = store.createTab()!;
    const raw = localStorage.getItem('trino_tabs_index');
    expect(raw).not.toBeNull();
    const index = JSON.parse(raw!);
    expect(Array.isArray(index.tabs)).toBe(true);
    expect(index.tabs.length).toBe(2);
    expect(index.tabs.some((t: { id: string }) => t.id === tab.id)).toBe(true);
  });

  it('handles multiple closeTab and createTab cycles', () => {
    store.createTab();
    store.createTab();
    expect(store.tabs.length).toBe(3);

    store.closeTab(store.tabs[1].id);
    store.closeTab(store.tabs[1].id);
    expect(store.tabs.length).toBe(1);

    store.createTab();
    expect(store.tabs.length).toBe(2);
  });
});
