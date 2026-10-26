import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { PinnedLocation, RecentFile, RecentLocation } from './types.js';
import { joinHdfsPath } from './hdfs-path.js';

const STORAGE_ROUTE = '/(app)/storage/browse/[connection]/[bucket]/[...prefix]' as const;

// ── URL helpers ──────────────────────────────────────────────────────────────

function toBase64Url(value: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

/**
 * Encode a container for the `[bucket]` route segment. S3 bucket names pass
 * through unchanged. HDFS base paths always start with `/`, which is fragile
 * as `%2F` behind proxies, so they become `~` + base64url (`/` alone is `~`).
 * S3 bucket names cannot contain `~`, so the two never collide.
 */
export function encodeContainerSegment(container: string): string {
  if (!container.startsWith('/')) return encodeURIComponent(container);
  return container === '/' ? '~' : `~${toBase64Url(container)}`;
}

/**
 * Display URI for an object: `s3://bucket/key` for S3, the absolute path for
 * HDFS (whose containers are base paths starting with `/`).
 */
export function objectUri(container: string, key: string): string {
  if (container.startsWith('/')) return joinHdfsPath(container, key);
  return `s3://${container}/${key}`;
}

/** Inverse of {@link encodeContainerSegment}, applied to the decoded route param. */
export function decodeContainerSegment(segment: string): string {
  if (!segment.startsWith('~')) return segment;
  if (segment === '~') return '/';
  try {
    return fromBase64Url(segment.slice(1));
  } catch {
    return segment;
  }
}

export function storageHref(connection: string, bucket: string, prefix: string): ResolvedPathname {
  const encodedBucket = encodeContainerSegment(bucket);
  const encodedPrefix = prefix
    ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
    : '';
  return resolve(STORAGE_ROUTE, {
    connection: encodeURIComponent(connection),
    bucket: encodedBucket,
    prefix: encodedPrefix
  });
}

// ── Pinned location helpers ──────────────────────────────────────────────────

export function pinnedLabel(pin: PinnedLocation): string {
  if (!pin.prefix) return pin.bucket;
  const parts = pin.prefix.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pin.bucket;
}

export function pinnedHref(connection: string, pin: PinnedLocation): ResolvedPathname {
  return storageHref(connection, pin.bucket, pin.prefix);
}

// ── Recent file helpers ──────────────────────────────────────────────────────

export function fileName(key: string): string {
  const parts = key.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? key;
}

export function fileLocation(file: RecentFile): string {
  const parts = file.key.split('/').filter(Boolean);
  parts.pop();
  return parts.length > 0 ? `${file.bucket} / ${parts.join(' / ')}` : file.bucket;
}

export function fileHref(connection: string, file: RecentFile): ResolvedPathname {
  const parts = file.key.split('/').filter(Boolean);
  parts.pop();
  const encodedPrefix = parts.map(encodeURIComponent).join('/');
  return resolve(STORAGE_ROUTE, {
    connection: encodeURIComponent(connection),
    bucket: encodeContainerSegment(file.bucket),
    prefix: encodedPrefix
  });
}

// ── Recent location helpers ──────────────────────────────────────────────────

export function locationName(loc: RecentLocation): string {
  if (!loc.prefix) return loc.bucket;
  const parts = loc.prefix.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? loc.bucket;
}

export function locationPath(loc: RecentLocation): string {
  if (!loc.prefix) return loc.bucket;
  const parts = loc.prefix.split('/').filter(Boolean);
  return `${loc.bucket} / ${parts.join(' / ')}`;
}

export function locationHref(connection: string, loc: RecentLocation): ResolvedPathname {
  return storageHref(connection, loc.bucket, loc.prefix);
}
