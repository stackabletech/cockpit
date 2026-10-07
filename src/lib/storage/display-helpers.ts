import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { SavedConnection } from './connection-storage.js';
import type { RecentFile } from './types.js';
import { keyToName } from './utils.js';

const STORAGE_ROUTE = '/(app)/storage/[bucket]/[...prefix]' as const;

/** Anything addressable as bucket + prefix — pinned and recent locations alike. */
type StorageLocation = { bucket: string; prefix: string };

// ── URL helpers ──────────────────────────────────────────────────────────────

export function storageHref(bucket: string, prefix: string): ResolvedPathname {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPrefix = prefix
    ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
    : '';
  return resolve(STORAGE_ROUTE, { bucket: encodedBucket, prefix: encodedPrefix });
}

// ── Location helpers ─────────────────────────────────────────────────────────

/** Last segment of the prefix, falling back to the bucket name at the root. */
export function locationLabel(loc: StorageLocation): string {
  return keyToName(loc.prefix) || loc.bucket;
}

/** Full breadcrumb-style path, e.g. `bucket / dir / subdir`. */
export function locationPath(loc: StorageLocation): string {
  if (!loc.prefix) return loc.bucket;
  const parts = loc.prefix.split('/').filter(Boolean);
  return `${loc.bucket} / ${parts.join(' / ')}`;
}

export function locationHref(loc: StorageLocation): ResolvedPathname {
  return storageHref(loc.bucket, loc.prefix);
}

// ── Recent file helpers ──────────────────────────────────────────────────────

/** The directory an object key lives in, without the trailing file name. */
function parentPrefix(key: string): string {
  const parts = key.split('/').filter(Boolean);
  parts.pop();
  return parts.join('/');
}

export function fileLocation(file: RecentFile): string {
  return locationPath({ bucket: file.bucket, prefix: parentPrefix(file.key) });
}

export function fileHref(file: RecentFile): ResolvedPathname {
  return storageHref(file.bucket, parentPrefix(file.key));
}

// ── Connection helpers ───────────────────────────────────────────────────────

/** Display name for a saved connection: its own name if set, else `host[:port]`. */
export function connectionLabel(conn: SavedConnection): string {
  if (conn.name) return conn.name;
  return conn.port ? `${conn.host}:${conn.port}` : conn.host;
}
