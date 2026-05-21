import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';
import type { PinnedLocation, RecentFile, RecentLocation } from './types.js';

const STORAGE_ROUTE = '/(app)/storage/[bucket]/[...prefix]' as const;

// ── URL helpers ──────────────────────────────────────────────────────────────

export function storageHref(bucket: string, prefix: string): ResolvedPathname {
  const encodedBucket = encodeURIComponent(bucket);
  const encodedPrefix = prefix
    ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
    : '';
  return resolve(STORAGE_ROUTE, { bucket: encodedBucket, prefix: encodedPrefix });
}

// ── Pinned location helpers ──────────────────────────────────────────────────

export function pinnedLabel(pin: PinnedLocation): string {
  if (!pin.prefix) return pin.bucket;
  const parts = pin.prefix.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? pin.bucket;
}

export function pinnedHref(pin: PinnedLocation): ResolvedPathname {
  return storageHref(pin.bucket, pin.prefix);
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

export function fileHref(file: RecentFile): ResolvedPathname {
  const parts = file.key.split('/').filter(Boolean);
  parts.pop();
  const encodedPrefix = parts.map(encodeURIComponent).join('/');
  return resolve(STORAGE_ROUTE, {
    bucket: encodeURIComponent(file.bucket),
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

export function locationHref(loc: RecentLocation): ResolvedPathname {
  return storageHref(loc.bucket, loc.prefix);
}
