import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { ConnectionMetadata } from './connection-types.js';
import type { RecentFile } from './types.js';
import { keyToName, parentPrefix } from './utils.js';

const STORAGE_ROUTE = '/(app)/storage/browse/[connection]/[bucket]/[...prefix]' as const;

/** Anything addressable as bucket + prefix — pinned and recent locations alike. */
type StorageLocation = { bucket: string; prefix: string };

// ── URL helpers ──────────────────────────────────────────────────────────────

export function storageHref(connection: string, bucket: string, prefix: string): ResolvedPathname {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPrefix = prefix
    ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
    : '';
  return resolve(STORAGE_ROUTE, {
    connection: encodeURIComponent(connection),
    bucket: encodedBucket,
    prefix: encodedPrefix
  });
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

export function locationHref(connection: string, loc: StorageLocation): ResolvedPathname {
  return storageHref(connection, loc.bucket, loc.prefix);
}

// ── Recent file helpers ──────────────────────────────────────────────────────

export function fileLocation(file: RecentFile): string {
  return locationPath({ bucket: file.bucket, prefix: parentPrefix(file.key) });
}

export function fileHref(connection: string, file: RecentFile): ResolvedPathname {
  return storageHref(connection, file.bucket, parentPrefix(file.key));
}

// ── Connection helpers ───────────────────────────────────────────────────────

/** Display name for a connection: its own name if set, else its endpoint. */
export function connectionLabel(conn: Pick<ConnectionMetadata, 'name' | 'endpoint'>): string {
  return conn.name || conn.endpoint || 'S3';
}
