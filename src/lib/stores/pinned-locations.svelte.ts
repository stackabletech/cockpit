export interface PinnedLocation {
  bucket: string;
  /** Empty string = bucket root; otherwise a key prefix ending in '/', e.g. 'folder/sub/' */
  prefix: string;
}

const STORAGE_KEY = 'pinned_storage_locations';

function loadPinned(): PinnedLocation[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PinnedLocation[]) : [];
  } catch {
    return [];
  }
}

export const pinnedLocations = $state<PinnedLocation[]>(loadPinned());

function persist() {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...pinnedLocations]));
  }
}

export function pinLocation(bucket: string, prefix: string): void {
  if (pinnedLocations.some((p) => p.bucket === bucket && p.prefix === prefix)) return;
  pinnedLocations.push({ bucket, prefix });
  persist();
}

export function unpinLocation(bucket: string, prefix: string): void {
  const idx = pinnedLocations.findIndex((p) => p.bucket === bucket && p.prefix === prefix);
  if (idx !== -1) {
    pinnedLocations.splice(idx, 1);
    persist();
  }
}

export function isPinned(bucket: string, prefix: string): boolean {
  return pinnedLocations.some((p) => p.bucket === bucket && p.prefix === prefix);
}

/** Returns the display label for a pinned location. */
export function pinnedLabel(pin: PinnedLocation): string {
  if (!pin.prefix) return pin.bucket;
  const parts = pin.prefix.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pin.bucket;
}

/** Returns the navigation href for a pinned location. */
export function pinnedHref(pin: PinnedLocation): string {
  if (!pin.prefix) return `/storage/${encodeURIComponent(pin.bucket)}`;
  const encodedPrefix = pin.prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/');
  return `/storage/${encodeURIComponent(pin.bucket)}/${encodedPrefix}`;
}
