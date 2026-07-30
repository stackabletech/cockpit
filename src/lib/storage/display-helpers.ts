import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { PinnedLocation, RecentFile, RecentLocation } from './types.js';

const APP_STORAGE_ROUTE = '/(app)/storage/[bucket]/[...prefix]' as const;

// ── URL helpers ──────────────────────────────────────────────────────────────

/**
 * Default (app-route) href for a bucket/prefix. Components that are used in
 * both `(app)/storage` and `embed/storage` should receive a custom `hrefFn`
 * obtained from `getStorageRouteBase().storageHref` so links stay within the
 * correct route tree.
 */
export function storageHref(bucket: string, prefix: string): ResolvedPathname {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPrefix = prefix
    ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
    : '';
  return resolve(APP_STORAGE_ROUTE, { bucket: encodedBucket, prefix: encodedPrefix });
}

// ── Pinned location helpers ──────────────────────────────────────────────────

export function pinnedLabel(pin: PinnedLocation): string {
  if (!pin.prefix) return pin.bucket;
  const parts = pin.prefix.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pin.bucket;
}

export function pinnedHref(
  pin: PinnedLocation,
  hrefFn: (bucket: string, prefix: string) => string = storageHref
): string {
  return hrefFn(pin.bucket, pin.prefix);
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

export function fileHref(
  file: RecentFile,
  hrefFn: (bucket: string, prefix: string) => string = storageHref
): string {
  const parts = file.key.split('/').filter(Boolean);
  parts.pop();
  // hrefFn encodes each segment internally; pass raw (unencoded) parts joined
  return hrefFn(file.bucket, parts.join('/'));
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

export function locationHref(
  loc: RecentLocation,
  hrefFn: (bucket: string, prefix: string) => string = storageHref
): string {
  return hrefFn(loc.bucket, loc.prefix);
}
