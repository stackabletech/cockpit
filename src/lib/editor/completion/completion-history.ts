// LRU memory of recently-accepted completion items, persisted to
// localStorage. Items in their kind's list are biased above unused items via
// their `sortText` so the user's working vocabulary surfaces to the top.

export type HistoryCategory =
  | 'catalogs'
  | 'schemas'
  | 'tables'
  | 'columns'
  | 'functions'
  | 'keywords';

const CAPS: Record<HistoryCategory, number> = {
  catalogs: 10,
  schemas: 20,
  tables: 100,
  columns: 200,
  functions: 25,
  keywords: 20
};

const STORAGE_KEY = 'stackable_completion_history_v1';
const SAVE_DEBOUNCE_MS = 250;

type HistoryStore = Record<HistoryCategory, string[]>;

function emptyStore(): HistoryStore {
  return { catalogs: [], schemas: [], tables: [], columns: [], functions: [], keywords: [] };
}

let store: HistoryStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function loadHistory(): HistoryStore {
  if (store) return store;
  if (typeof localStorage === 'undefined') {
    store = emptyStore();
    return store;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      store = emptyStore();
      return store;
    }
    const parsed = JSON.parse(raw) as Partial<HistoryStore>;
    const fresh = emptyStore();
    for (const category of Object.keys(fresh) as HistoryCategory[]) {
      const list = parsed[category];
      if (Array.isArray(list)) {
        // Sanitize: strings only, deduped, capped.
        const seen = new Set<string>();
        for (const name of list) {
          if (typeof name !== 'string' || seen.has(name)) continue;
          seen.add(name);
          fresh[category].push(name);
          if (fresh[category].length >= CAPS[category]) break;
        }
      }
    }
    store = fresh;
  } catch {
    store = emptyStore();
  }
  return store;
}

function scheduleSave(): void {
  if (typeof localStorage === 'undefined') return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // localStorage may be unavailable (private mode, quota); silent fail is fine.
    }
  }, SAVE_DEBOUNCE_MS);
}

/** Record that the user accepted `name` as a completion of the given
 *  category. Moves it to the front of the LRU list and persists. */
export function recordUse(category: HistoryCategory, name: string): void {
  const history = loadHistory();
  const list = history[category];
  const index = list.indexOf(name);
  if (index === 0) return; // already at the head, nothing to do
  if (index > 0) list.splice(index, 1);
  list.unshift(name);
  if (list.length > CAPS[category]) list.length = CAPS[category];
  scheduleSave();
}

/** Index of `name` in its category's LRU (0 = most recent), or null if not
 *  present. The caller uses this to bias `sortText`. */
export function rankOf(category: HistoryCategory, name: string): number | null {
  const history = loadHistory();
  const index = history[category].indexOf(name);
  return index < 0 ? null : index;
}

/** Build the sortText prefix for a ranked item. Padded so string sort matches
 *  numeric order (`!_005_…` < `!_010_…`). The leading `!` sorts before any
 *  alphanumeric prefix used elsewhere, so any ranked item beats any unranked
 *  one regardless of category tier. */
export function sortPrefixForRank(rank: number): string {
  return `!_${String(rank).padStart(3, '0')}_`;
}

/** Test-only: drop the in-memory cache and any persisted state. */
export function _resetCompletionHistory(): void {
  store = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }
}
