import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TabsState, type PersistedTabsState } from '$lib/storage/tabs.svelte.js';
import { StorageState } from '$lib/storage/state.svelte.js';
import { LS_TABS } from '$lib/storage/persistence.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStorage(bucket = 'test-bucket', prefix = ''): StorageState {
  const state = new StorageState({ connected: true });
  state.bucket = bucket;
  state.prefix = prefix;
  state.connectionHostname = 's3.example.com';
  state.objects = { objects: [], hasNextPage: false, currentPage: 1, pageSize: 25 };
  return state;
}

function makeTabs(
  storage: StorageState,
  opts?: { persistEnabled?: boolean; connectionId?: string | null }
) {
  const navigateToLocation = vi.fn();
  const replaceLocationUrl = vi.fn();
  const ts = new TabsState(storage, {
    persistEnabled: opts?.persistEnabled ?? false,
    connectionId: opts?.connectionId ?? null,
    navigateToLocation,
    replaceLocationUrl
  });
  return { ts, navigateToLocation, replaceLocationUrl };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TabsState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ── ensureInitialTab ──────────────────────────────────────────────────────

  describe('ensureInitialTab', () => {
    it('creates an initial tab from storage state', () => {
      const storage = makeStorage('my-bucket', '');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      expect(ts.tabs.length).toBe(1);
      expect(ts.tabs[0].label).toBe('my-bucket');
      expect(ts.tabs[0].stub).toBe(false);
      expect(ts.activeTabId).toBe(ts.tabs[0].id);
    });

    it('uses last path segment as label when prefix is set', () => {
      const storage = makeStorage('bucket', 'reports/2024/');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      expect(ts.tabs[0].label).toBe('2024');
    });

    it('is a no-op when tabs already exist', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.ensureInitialTab();

      expect(ts.tabs.length).toBe(1);
    });
  });

  // ── hasTabs ───────────────────────────────────────────────────────────────

  describe('hasTabs', () => {
    it('returns true with one tab', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      expect(ts.hasTabs).toBe(true);
    });

    it('returns true with two or more tabs', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();

      expect(ts.hasTabs).toBe(true);
    });
  });

  // ── addTab ────────────────────────────────────────────────────────────────

  describe('addTab', () => {
    it('appends a tab at the current location', () => {
      const storage = makeStorage('bucket', 'folder/');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();

      expect(ts.tabs.length).toBe(2);
      expect(ts.activeTabId).toBe(ts.tabs[1].id);
      expect(ts.tabs[1].label).toBe('folder');
    });

    it('new tab is not a stub', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();

      expect(ts.tabs[1].stub).toBe(false);
    });

    it('snapshot captures current storage state', () => {
      const storage = makeStorage('bucket', 'data/');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      storage.prefix = 'other/';
      ts.addTab();

      expect(ts.tabs[1].snapshot.prefix).toBe('other/');
    });
  });

  // ── switchTo ──────────────────────────────────────────────────────────────

  describe('switchTo', () => {
    it('is a no-op when switching to the already-active tab', () => {
      const storage = makeStorage();
      const { ts, replaceLocationUrl, navigateToLocation } = makeTabs(storage);
      ts.ensureInitialTab();

      ts.switchTo(ts.activeTabId!);

      expect(replaceLocationUrl).not.toHaveBeenCalled();
      expect(navigateToLocation).not.toHaveBeenCalled();
    });

    it('restores snapshot and calls replaceLocationUrl for non-stub tab', () => {
      const storage = makeStorage('bucket', 'a/');
      const { ts, replaceLocationUrl } = makeTabs(storage);
      ts.ensureInitialTab(); // tabs[0] = {prefix:'a/'}, active

      // Add a second tab at the same location, then navigate the second tab to 'b/'
      ts.addTab(); // tabs[1] = {prefix:'a/'}, active = tabs[1]
      storage.prefix = 'b/';
      ts.syncActiveTab(); // tabs[1].snapshot.prefix = 'b/'

      // Now: tabs[0]={prefix:'a/'}, tabs[1]={prefix:'b/'} (active)
      ts.switchTo(ts.tabs[0].id);

      expect(storage.prefix).toBe('a/');
      expect(replaceLocationUrl).toHaveBeenCalledWith('s3.example.com', 'bucket', 'a/');
    });

    it('calls navigateToLocation for a stub tab', () => {
      const storage = makeStorage('bucket', 'a/');
      const { ts, navigateToLocation } = makeTabs(storage);

      const saved: PersistedTabsState = {
        tabs: [
          { id: 'a', label: 'A', bucket: 'bucket', prefix: 'a/' },
          { id: 'b', label: 'B', bucket: 'bucket', prefix: 'b/' }
        ],
        activeTabId: 'a'
      };
      ts.restorePersistedTabs(saved);
      // tabs[0] gets markActiveTabLoaded() because storage matches 'a/'
      // tabs[1] stays as a stub

      ts.switchTo(ts.tabs[1].id);

      expect(navigateToLocation).toHaveBeenCalledWith('s3.example.com', 'bucket', 'b/');
    });

    it('sets activeTabId to the switched-to tab', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();
      const firstId = ts.tabs[0].id;

      ts.switchTo(firstId);

      expect(ts.activeTabId).toBe(firstId);
    });
  });

  // ── closeTab ──────────────────────────────────────────────────────────────

  describe('closeTab', () => {
    it('removes the tab from the list', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();
      const firstId = ts.tabs[0].id;

      ts.closeTab(firstId);

      expect(ts.tabs.length).toBe(1);
      expect(ts.tabs.find((t) => t.id === firstId)).toBeUndefined();
    });

    it('switches to an adjacent tab when the active tab is closed', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();
      const secondId = ts.tabs[1].id;

      ts.closeTab(secondId); // active tab closed

      expect(ts.activeTabId).toBe(ts.tabs[0].id);
    });

    it('does not close the only remaining tab', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      ts.closeTab(ts.tabs[0].id);

      expect(ts.tabs.length).toBe(1);
    });
  });

  // ── renameTab ─────────────────────────────────────────────────────────────

  describe('renameTab', () => {
    it('renames the tab with the given id', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      ts.renameTab(ts.tabs[0].id, 'My Custom Name');

      expect(ts.tabs[0].label).toBe('My Custom Name');
    });

    it('is a no-op for an unknown id', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      ts.renameTab('nonexistent-id', 'New Name');

      expect(ts.tabs[0].label).toBe('test-bucket');
    });
  });

  // ── reorderTabs ───────────────────────────────────────────────────────────

  describe('reorderTabs', () => {
    it('moves a tab from one index to another', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();
      ts.addTab();
      const ids = ts.tabs.map((t) => t.id);

      ts.reorderTabs(0, 2);

      expect(ts.tabs[2].id).toBe(ids[0]);
      expect(ts.tabs[0].id).toBe(ids[1]);
    });

    it('is a no-op when fromIdx === toIdx', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();
      const ids = ts.tabs.map((t) => t.id);

      ts.reorderTabs(0, 0);

      expect(ts.tabs.map((t) => t.id)).toEqual(ids);
    });
  });

  // ── syncActiveTab ─────────────────────────────────────────────────────────

  describe('syncActiveTab', () => {
    it('keeps other tabs at their own bucket when the active tab changes bucket', () => {
      const storage = makeStorage('bucket-a', '');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.addTab();

      storage.bucket = 'bucket-b';
      storage.prefix = '';
      ts.syncActiveTab();

      expect(ts.tabs[0].snapshot.bucket).toBe('bucket-a');
      expect(ts.tabs[1].snapshot.bucket).toBe('bucket-b');
    });

    it('updates snapshot bucket and prefix from current storage state', () => {
      const storage = makeStorage('bucket', 'old/');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      storage.prefix = 'new/';
      ts.syncActiveTab();

      expect(ts.tabs[0].snapshot.prefix).toBe('new/');
    });

    it('updates the auto-generated label to match new location', () => {
      const storage = makeStorage('bucket', 'old/');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      storage.prefix = 'new/';
      ts.syncActiveTab();

      expect(ts.tabs[0].label).toBe('new');
    });

    it('preserves a custom label that was manually set', () => {
      const storage = makeStorage('bucket', 'folder/');
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      ts.renameTab(ts.tabs[0].id, 'My Custom');

      storage.prefix = 'other/';
      ts.syncActiveTab();

      expect(ts.tabs[0].label).toBe('My Custom');
    });
  });

  // ── markActiveTabLoaded ───────────────────────────────────────────────────

  describe('markActiveTabLoaded', () => {
    it('clears the stub flag on the active tab', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();
      // Force it to be a stub
      ts.tabs = [{ ...ts.tabs[0], stub: true }];

      ts.markActiveTabLoaded();

      expect(ts.tabs[0].stub).toBe(false);
    });

    it('is a no-op when the active tab is not a stub', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.ensureInitialTab();

      // Should not throw or mutate
      ts.markActiveTabLoaded();

      expect(ts.tabs[0].stub).toBe(false);
    });
  });

  // ── persistence ───────────────────────────────────────────────────────────

  describe('peekPersistedTabs', () => {
    it('returns null when persistence is disabled', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage, { persistEnabled: false });

      expect(ts.peekPersistedTabs()).toBeNull();
    });

    it('returns null when nothing is saved in localStorage', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage, { persistEnabled: true });

      expect(ts.peekPersistedTabs()).toBeNull();
    });

    it('returns saved data after ensureInitialTab saves it', () => {
      const storage = makeStorage('bucket', '');
      const { ts } = makeTabs(storage, { persistEnabled: true });
      ts.ensureInitialTab();

      const peeked = ts.peekPersistedTabs();

      expect(peeked).not.toBeNull();
      expect(peeked!.tabs[0].bucket).toBe('bucket');
    });

    it('returns null for a different connectionId', () => {
      const saved: PersistedTabsState = {
        tabs: [{ id: '1', label: 'Bucket', bucket: 'bucket', prefix: '' }],
        activeTabId: '1',
        connectionId: 'conn-a'
      };
      localStorage.setItem(LS_TABS, JSON.stringify(saved));

      const storage = makeStorage();
      const { ts } = makeTabs(storage, { persistEnabled: true, connectionId: 'conn-b' });

      expect(ts.peekPersistedTabs()).toBeNull();
    });

    it('accepts saved data with no connectionId (backward compatibility)', () => {
      const saved: PersistedTabsState = {
        tabs: [{ id: '1', label: 'Bucket', bucket: 'bucket', prefix: '' }],
        activeTabId: '1'
        // connectionId absent intentionally
      };
      localStorage.setItem(LS_TABS, JSON.stringify(saved));

      const storage = makeStorage();
      const { ts } = makeTabs(storage, { persistEnabled: true, connectionId: 'conn-a' });

      expect(ts.peekPersistedTabs()).not.toBeNull();
    });

    it('accepts saved data when connectionIds match', () => {
      const saved: PersistedTabsState = {
        tabs: [{ id: '1', label: 'Bucket', bucket: 'bucket', prefix: '' }],
        activeTabId: '1',
        connectionId: 'conn-a'
      };
      localStorage.setItem(LS_TABS, JSON.stringify(saved));

      const storage = makeStorage();
      const { ts } = makeTabs(storage, { persistEnabled: true, connectionId: 'conn-a' });

      expect(ts.peekPersistedTabs()).not.toBeNull();
    });
  });

  describe('clearPersistedTabs', () => {
    it('removes the entry from localStorage', () => {
      const storage = makeStorage();
      const { ts } = makeTabs(storage, { persistEnabled: true });
      ts.ensureInitialTab();

      ts.clearPersistedTabs();

      expect(localStorage.getItem(LS_TABS)).toBeNull();
    });
  });

  describe('ensureInitialTab persistence write', () => {
    it('writes tab data to localStorage when persistEnabled', () => {
      const storage = makeStorage('bucket', '');
      const { ts } = makeTabs(storage, { persistEnabled: true });
      ts.ensureInitialTab();

      const raw = localStorage.getItem(LS_TABS);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!) as PersistedTabsState;
      expect(parsed.tabs.length).toBe(1);
      expect(parsed.tabs[0].bucket).toBe('bucket');
    });
  });

  // ── restorePersistedTabs ──────────────────────────────────────────────────

  describe('restorePersistedTabs', () => {
    it('creates stub tabs from saved data', () => {
      const saved: PersistedTabsState = {
        tabs: [
          { id: 'old1', label: 'Tab A', bucket: 'bucket', prefix: 'folder/' },
          { id: 'old2', label: 'Tab B', bucket: 'bucket', prefix: 'other/' }
        ],
        activeTabId: 'old2'
      };
      const storage = makeStorage('bucket', 'folder/');
      const { ts } = makeTabs(storage);
      ts.restorePersistedTabs(saved);

      expect(ts.tabs.length).toBe(2);
      expect(ts.tabs[0].label).toBe('Tab A');
      expect(ts.tabs[1].label).toBe('Tab B');
    });

    it('sets activeTabId to the saved active tab (by position)', () => {
      const saved: PersistedTabsState = {
        tabs: [
          { id: 'a', label: 'A', bucket: 'b', prefix: '' },
          { id: 'b', label: 'B', bucket: 'b', prefix: 'x/' }
        ],
        activeTabId: 'b'
      };
      const storage = makeStorage('b', '');
      const { ts } = makeTabs(storage);
      ts.restorePersistedTabs(saved);

      // activeTabId should correspond to the second tab (position index 1)
      expect(ts.activeTabId).toBe(ts.tabs[1].id);
    });

    it('generates fresh UUIDs — does not reuse the saved ids', () => {
      const saved: PersistedTabsState = {
        tabs: [{ id: 'old-id', label: 'A', bucket: 'b', prefix: '' }],
        activeTabId: 'old-id'
      };
      const storage = makeStorage();
      const { ts } = makeTabs(storage);
      ts.restorePersistedTabs(saved);

      expect(ts.tabs[0].id).not.toBe('old-id');
    });

    it('marks active tab as loaded when storage is already at that location', () => {
      const saved: PersistedTabsState = {
        tabs: [{ id: '1', label: 'Bucket', bucket: 'test-bucket', prefix: '' }],
        activeTabId: '1'
      };
      const storage = makeStorage('test-bucket', '');
      const { ts } = makeTabs(storage);
      ts.restorePersistedTabs(saved);

      expect(ts.tabs[0].stub).toBe(false);
    });

    it('leaves tab as stub when storage location differs from active tab', () => {
      const saved: PersistedTabsState = {
        tabs: [
          { id: 'a', label: 'A', bucket: 'bucket', prefix: 'a/' },
          { id: 'b', label: 'B', bucket: 'bucket', prefix: 'b/' }
        ],
        activeTabId: 'b'
      };
      const storage = makeStorage('bucket', 'a/'); // at a/, but active tab is b/
      const { ts, navigateToLocation } = makeTabs(storage);
      ts.restorePersistedTabs(saved);

      // Active tab (b/) is a stub and storage is at a/ → navigate is called
      expect(navigateToLocation).toHaveBeenCalledWith('s3.example.com', 'bucket', 'b/');
    });
  });

  // ── requestTabsRestore ────────────────────────────────────────────────────

  describe('requestTabsRestore', () => {
    it('triggers restore on the next ensureInitialTab call when persistEnabled', () => {
      const saved: PersistedTabsState = {
        tabs: [
          { id: 'a', label: 'A', bucket: 'b1', prefix: '' },
          { id: 'b', label: 'B', bucket: 'b2', prefix: '' }
        ],
        activeTabId: 'a'
      };
      localStorage.setItem(LS_TABS, JSON.stringify(saved));

      const storage = makeStorage('b1', '');
      const { ts } = makeTabs(storage, { persistEnabled: true });
      ts.ensureInitialTab();

      // Should have restored 2 tabs rather than creating 1 fresh tab
      expect(ts.tabs.length).toBe(2);
    });

    it('restores from localStorage on every ensureInitialTab when persistEnabled', () => {
      const saved: PersistedTabsState = {
        tabs: [
          { id: 'a', label: 'A', bucket: 'b1', prefix: '' },
          { id: 'b', label: 'B', bucket: 'b2', prefix: '' }
        ],
        activeTabId: 'a'
      };
      localStorage.setItem(LS_TABS, JSON.stringify(saved));

      // First TabsState restores from localStorage
      const storage1 = makeStorage('b1', '');
      const { ts: ts1 } = makeTabs(storage1, { persistEnabled: true });
      ts1.ensureInitialTab();
      expect(ts1.tabs.length).toBe(2);

      // Second TabsState — persistence is still enabled and data exists,
      // so it restores from localStorage again (handles page reloads)
      const storage2 = makeStorage('b1', '');
      const { ts: ts2 } = makeTabs(storage2, { persistEnabled: true });
      ts2.ensureInitialTab();
      expect(ts2.tabs.length).toBe(2);
    });
  });
});
