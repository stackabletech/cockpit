import { browser } from '$app/environment';
import * as m from '$lib/paraglide/messages.js';

const MAX_TABS = 8;
const STORAGE_KEY = 'trino_tabs';
const LEGACY_SQL_KEY = 'trino_sql';
const DEFAULT_SQL = 'SELECT 1';

export interface TabState {
  id: string;
  sql: string;
  label: string | null; // null = auto-derived
  createdAt: number;
}

interface PersistedState {
  tabs: TabState[];
  activeTabId: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

/** Derive a short tab name from the SQL content. */
function deriveLabel(sql: string, index: number): string {
  const trimmed = sql.trim();
  if (!trimmed) return m.trino_tab_default_name({ number: String(index + 1) });

  // Try to extract first keyword + object name from first line.
  const firstLine = trimmed.split('\n')[0].trim();
  const match = firstLine.match(
    /^(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|WITH|SHOW|DESCRIBE|EXPLAIN|USE)\b\s*(.*)/i
  );
  if (match) {
    const keyword = match[1].toUpperCase();
    const rest = match[2].trim().substring(0, 30);
    if (rest) return `${keyword} ${rest}`;
    return keyword;
  }

  // Fallback: first 30 chars of first line.
  return firstLine.substring(0, 30) || m.trino_tab_default_name({ number: String(index + 1) });
}

function makeTab(sql: string = DEFAULT_SQL): TabState {
  return {
    id: generateId(),
    sql,
    label: null,
    createdAt: Date.now()
  };
}

function loadFromStorage(): PersistedState | null {
  if (!browser) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0 && parsed.activeTabId) {
        return parsed;
      }
    }
  } catch {
    // Ignore corrupt data.
  }
  return null;
}

/** Migrate from legacy single-SQL localStorage to tab state. */
function migrateFromLegacy(): PersistedState | null {
  if (!browser) return null;
  try {
    const legacySql = localStorage.getItem(LEGACY_SQL_KEY);
    if (legacySql !== null) {
      const tab = makeTab(legacySql);
      localStorage.removeItem(LEGACY_SQL_KEY);
      return { tabs: [tab], activeTabId: tab.id };
    }
  } catch {
    // Ignore.
  }
  return null;
}

function createDefaultState(): PersistedState {
  const tab = makeTab();
  return { tabs: [tab], activeTabId: tab.id };
}

function persistToStorage(tabs: TabState[], activeTabId: string) {
  if (!browser) return;
  try {
    const data: PersistedState = {
      tabs: tabs.map((t) => ({ id: t.id, sql: t.sql, label: t.label, createdAt: t.createdAt })),
      activeTabId
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors.
  }
}

function createTabStore() {
  // Initialise from storage, legacy migration, or default.
  const initial = loadFromStorage() ?? migrateFromLegacy() ?? createDefaultState();

  // eslint-disable-next-line prefer-const -- $state arrays are mutated in place
  let tabs = $state<TabState[]>(initial.tabs);
  let activeTabId = $state<string>(initial.activeTabId);

  // Ensure activeTabId points to a valid tab.
  if (!tabs.some((t) => t.id === activeTabId)) {
    activeTabId = tabs[0].id;
  }

  const activeTab = $derived(tabs.find((t) => t.id === activeTabId)!);

  function save() {
    persistToStorage(tabs, activeTabId);
  }

  function createTab(): TabState | null {
    if (tabs.length >= MAX_TABS) return null;
    const tab = makeTab();
    tabs.push(tab);
    activeTabId = tab.id;
    save();
    return tab;
  }

  function closeTab(id: string): void {
    if (tabs.length <= 1) return;
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    tabs.splice(index, 1);

    if (activeTabId === id) {
      // Switch to the tab at the same position, or the last one.
      const newIndex = Math.min(index, tabs.length - 1);
      activeTabId = tabs[newIndex].id;
    }
    save();
  }

  function switchTab(id: string): void {
    if (tabs.some((t) => t.id === id)) {
      activeTabId = id;
      save();
    }
  }

  function reorderTabs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= tabs.length) return;
    if (toIndex < 0 || toIndex >= tabs.length) return;
    const [moved] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, moved);
    save();
  }

  function updateSql(id: string, sql: string): void {
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      tab.sql = sql;
      save();
    }
  }

  function renameTab(id: string, label: string | null): void {
    const tab = tabs.find((t) => t.id === id);
    if (tab) {
      tab.label = label && label.trim() ? label.trim() : null;
      save();
    }
  }

  function getTabLabel(tab: TabState): string {
    if (tab.label) return tab.label;
    const index = tabs.indexOf(tab);
    return deriveLabel(tab.sql, index);
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
