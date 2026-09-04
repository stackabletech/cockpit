import { browser } from '$app/environment';
import * as m from '$lib/paraglide/messages.js';

const MAX_TABS = 8;
const INDEX_KEY = 'trino_tabs_index';
const TAB_KEY_PREFIX = 'trino_tab_';
const DEFAULT_SQL = 'SELECT 1';
const DEBOUNCE_MS = 500;

/** Maximum characters allowed per tab's SQL content. */
export const MAX_SQL_LENGTH = 250_000;

export interface TabState {
  id: string;
  sql: string;
  label: string | null; // null = auto-derived
  createdAt: number;
}

interface IndexData {
  tabs: { id: string; label: string | null; createdAt: number }[];
  activeTabId: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

function makeTab(sql: string = DEFAULT_SQL): TabState {
  return {
    id: generateId(),
    sql,
    label: null,
    createdAt: Date.now()
  };
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function readIndex(): IndexData | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IndexData;
    if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0 && parsed.activeTabId) {
      return parsed;
    }
  } catch {
    // Ignore corrupt data.
  }
  return null;
}

function readTabSql(id: string): string {
  try {
    return localStorage.getItem(TAB_KEY_PREFIX + id) ?? DEFAULT_SQL;
  } catch {
    return DEFAULT_SQL;
  }
}

/** Load tabs from the new split format, falling back through legacy formats. */
function loadFromStorage(): { tabs: TabState[]; activeTabId: string } | null {
  if (!browser) return null;

  const index = readIndex();
  if (index) {
    const tabs: TabState[] = index.tabs.map((entry) => ({
      id: entry.id,
      label: entry.label,
      createdAt: entry.createdAt,
      sql: readTabSql(entry.id)
    }));
    return { tabs, activeTabId: index.activeTabId };
  }

  return null;
}

function createDefaultState(): { tabs: TabState[]; activeTabId: string } {
  const tab = makeTab();
  return { tabs: [tab], activeTabId: tab.id };
}

// ---------------------------------------------------------------------------
// Persist helpers (write)
// ---------------------------------------------------------------------------

function persistIndex(tabs: TabState[], activeTabId: string): boolean {
  if (!browser) return true;
  try {
    const data: IndexData = {
      tabs: tabs.map((t) => ({ id: t.id, label: t.label, createdAt: t.createdAt })),
      activeTabId
    };
    localStorage.setItem(INDEX_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

function persistTabSql(id: string, sql: string): boolean {
  if (!browser) return true;
  try {
    localStorage.setItem(TAB_KEY_PREFIX + id, sql);
    return true;
  } catch {
    return false;
  }
}

function removeTabSql(id: string) {
  if (!browser) return;
  try {
    localStorage.removeItem(TAB_KEY_PREFIX + id);
  } catch {
    // Best effort.
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function createTabStore() {
  const initial = loadFromStorage() ?? createDefaultState();

  // eslint-disable-next-line prefer-const -- $state arrays are mutated in place
  let tabs = $state<TabState[]>(initial.tabs);
  let activeTabId = $state<string>(initial.activeTabId);
  let persistError = $state(false);

  // Ensure activeTabId points to a valid tab.
  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id;
  }

  // Persist the initial state if this was a fresh default or migration.
  if (!readIndex()) {
    persistIndex(tabs, activeTabId);
    for (const tab of tabs) {
      persistTabSql(tab.id, tab.sql);
    }
  }

  const activeTab = $derived(tabs.find((t) => t.id === activeTabId)!);

  // Debounce timer for SQL persistence.
  let sqlDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  function saveIndex() {
    persistError = !persistIndex(tabs, activeTabId);
    return !persistError;
  }

  function saveSql(id: string, sql: string) {
    persistError = !persistTabSql(id, sql);
  }

  function saveSqlDebounced(id: string, sql: string) {
    clearTimeout(sqlDebounceTimer);
    sqlDebounceTimer = setTimeout(() => saveSql(id, sql), DEBOUNCE_MS);
  }

  function flushPendingSql() {
    if (sqlDebounceTimer !== undefined) {
      clearTimeout(sqlDebounceTimer);
      sqlDebounceTimer = undefined;
      const tab = tabs.find((t) => t.id === activeTabId);
      if (tab) saveSql(tab.id, tab.sql);
    }
  }

  function createTab(): TabState | null {
    if (tabs.length >= MAX_TABS) return null;
    flushPendingSql();
    const tab = makeTab();
    tabs.push(tab);
    activeTabId = tab.id;
    saveIndex();
    saveSql(tab.id, tab.sql);
    return tab;
  }

  function closeTab(id: string): void {
    if (tabs.length <= 1) return;
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    // If closing the tab that has a pending debounce, cancel it.
    if (id === activeTabId) {
      clearTimeout(sqlDebounceTimer);
      sqlDebounceTimer = undefined;
    }

    tabs.splice(index, 1);
    removeTabSql(id);

    if (activeTabId === id) {
      const newIndex = Math.min(index, tabs.length - 1);
      // eslint-disable-next-line security/detect-object-injection
      activeTabId = tabs[newIndex].id;
    }
    saveIndex();
  }

  function switchTab(id: string): void {
    if (tabs.some((t) => t.id === id)) {
      flushPendingSql();
      activeTabId = id;
      saveIndex();
    }
  }

  function reorderTabs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    saveIndex();
  }

  function updateSql(id: string, sql: string): void {
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      const clamped = sql.length > MAX_SQL_LENGTH ? sql.slice(0, MAX_SQL_LENGTH) : sql;
      tab.sql = clamped;
      saveSqlDebounced(id, clamped);
    }
  }

  function renameTab(id: string, label: string | null): void {
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      tab.label = label && label.trim() ? label.trim() : null;
      saveIndex();
    }
  }

  function getTabLabel(tab: TabState): string {
    if (tab.label) return tab.label;
    return m.trino_tab_default_name();
  }

  return {
    get tabs() {
      return tabs;
    },
    get activeTabId() {
      return activeTabId;
    },
    get activeTab() {
      return activeTab;
    },
    get maxTabs() {
      return MAX_TABS;
    },
    get persistError() {
      return persistError;
    },
    createTab,
    closeTab,
    switchTab,
    reorderTabs,
    updateSql,
    renameTab,
    getTabLabel
  };
}

export const tabStore = createTabStore();
