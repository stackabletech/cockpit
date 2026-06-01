import { browser } from '$app/environment';

// ── localStorage keys ────────────────────────────────────────────────────────

export const LS_PINS = 'pinned_storage_locations';
export const LS_RECENT_FILES = 'recent_storage_files';
export const LS_RECENT_LOCATIONS = 'recent_storage_locations';
export const LS_TABS = 'storage_tabs';

export const MAX_RECENT = 15;

// ── Utilities ────────────────────────────────────────────────────────────────

export function loadFromStorage<T>(key: string): T[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

export function persistToStorage(key: string, data: unknown[]): void {
  if (browser) {
    localStorage.setItem(key, JSON.stringify(data));
  }
}
