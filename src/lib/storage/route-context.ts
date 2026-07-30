import { createContext } from 'svelte';
import { resolve } from '$app/paths';
import type { ResolvedPathname } from '$app/types';

export interface StorageRoutes {
  /** Generate a URL to a bucket/prefix path (raw, unencoded inputs). */
  storageHref: (bucket: string, prefix: string) => ResolvedPathname;
  /** Root path for storage, e.g. `/storage` or `/embed/storage`. */
  storageRoot: string;
  /** Connections root, e.g. `/storage/connections` or `/embed/storage/connections`. */
  connectionsRoot: string;
  /** Form action for disconnect, e.g. `/storage?/disconnect`. */
  disconnectAction: string;
  /** Regex to extract the active bucket name from `page.url.pathname`. */
  activeBucketRegex: RegExp;
}

function makeStorageHref(
  route: '/(app)/storage/[bucket]/[...prefix]' | '/embed/storage/[bucket]/[...prefix]'
) {
  return (bucket: string, prefix: string): ResolvedPathname => {
    const encodedBucket = encodeURIComponent(bucket);
    const encodedPrefix = prefix
      ? prefix.replace(/\/$/, '').split('/').map(encodeURIComponent).join('/')
      : '';
    return resolve(route, { bucket: encodedBucket, prefix: encodedPrefix });
  };
}

export const APP_STORAGE_ROUTES: StorageRoutes = {
  storageHref: makeStorageHref('/(app)/storage/[bucket]/[...prefix]'),
  storageRoot: '/storage',
  connectionsRoot: '/storage/connections',
  disconnectAction: '/storage?/disconnect',
  activeBucketRegex: /^\/storage\/([^/]+)/
};

export const EMBED_STORAGE_ROUTES: StorageRoutes = {
  storageHref: makeStorageHref('/embed/storage/[bucket]/[...prefix]'),
  storageRoot: '/embed/storage',
  connectionsRoot: '/embed/storage/connections',
  disconnectAction: '/embed/storage?/disconnect',
  activeBucketRegex: /^\/embed\/storage\/([^/]+)/
};

export const [getStorageRouteBase, setStorageRouteBase] = createContext<StorageRoutes>();
