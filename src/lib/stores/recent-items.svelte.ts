import { SvelteDate } from 'svelte/reactivity';

const MAX_RECENT = 15;
const LS_FILES = 'recent_storage_files';
const LS_LOCATIONS = 'recent_storage_locations';

// ── Types ─────────────────────────────────────────────────────────────────

export interface RecentFile {
  /** Full object key within the bucket. */
  key: string;
  bucket: string;
  /** File size in bytes. */
  size: number;
  /** ISO string so it survives JSON round-trip. */
  visitedAt: string;
}

export interface RecentLocation {
  bucket: string;
  /** Trailing-slash prefix, empty string = bucket root. */
  prefix: string;
  visitedAt: string;
}

// ── Persistence helpers ───────────────────────────────────────────────────

function load<T>(key: string): T[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function persist(key: string, data: unknown[]): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, JSON.stringify(data));
  }
}

// ── Reactive state ────────────────────────────────────────────────────────

export const recentFiles = $state<RecentFile[]>(load<RecentFile>(LS_FILES));
export const recentLocations = $state<RecentLocation[]>(load<RecentLocation>(LS_LOCATIONS));

// ── Mutators ──────────────────────────────────────────────────────────────

export function recordFileVisit(bucket: string, key: string, size: number): void {
  const idx = recentFiles.findIndex((f) => f.bucket === bucket && f.key === key);
  const entry: RecentFile = { key, bucket, size, visitedAt: new SvelteDate().toISOString() };
  if (idx !== -1) {
    recentFiles.splice(idx, 1);
  }
  recentFiles.unshift(entry);
  if (recentFiles.length > MAX_RECENT) recentFiles.splice(MAX_RECENT);
  persist(LS_FILES, [...recentFiles]);
}

export function recordLocationVisit(bucket: string, prefix: string): void {
  const idx = recentLocations.findIndex((l) => l.bucket === bucket && l.prefix === prefix);
  const entry: RecentLocation = { bucket, prefix, visitedAt: new SvelteDate().toISOString() };
  if (idx !== -1) {
    recentLocations.splice(idx, 1);
  }
  recentLocations.unshift(entry);
  if (recentLocations.length > MAX_RECENT) recentLocations.splice(MAX_RECENT);
  persist(LS_LOCATIONS, [...recentLocations]);
}

// ── Derived display helpers ───────────────────────────────────────────────

/** Display name for a file key (last path segment). */
export function fileName(key: string): string {
  const parts = key.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

/** Human-readable location path for a recent file: "bucket / folder / …" */
export function fileLocation(file: RecentFile): string {
  const parts = file.key.split('/').filter(Boolean);
  parts.pop(); // remove filename
  return parts.length > 0 ? `${file.bucket} / ${parts.join(' / ')}` : file.bucket;
}

/** Display name for a location: last path segment or bucket name. */
export function locationName(loc: RecentLocation): string {
  if (!loc.prefix) return loc.bucket;
  const parts = loc.prefix.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? loc.bucket;
}

/** Full breadcrumb path for a location. */
export function locationPath(loc: RecentLocation): string {
  if (!loc.prefix) return loc.bucket;
  const parts = loc.prefix.split('/').filter(Boolean);
  return `${loc.bucket} / ${parts.join(' / ')}`;
}

/** Navigation href for a recent file (goes to its parent folder). */
export function fileHref(file: RecentFile): string {
  const parts = file.key.split('/').filter(Boolean);
  parts.pop();
  const encoded = parts.map(encodeURIComponent).join('/');
  return encoded
    ? `/storage/${encodeURIComponent(file.bucket)}/${encoded}`
    : `/storage/${encodeURIComponent(file.bucket)}`;
}

/** Navigation href for a recent location. */
export function locationHref(loc: RecentLocation): string {
  if (!loc.prefix) return `/storage/${encodeURIComponent(loc.bucket)}`;
  const encoded = loc.prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/');
  return `/storage/${encodeURIComponent(loc.bucket)}/${encoded}`;
}
