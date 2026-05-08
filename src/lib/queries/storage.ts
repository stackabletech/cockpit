/**
 * TanStack Query key factories for storage-related queries.
 *
 * Centralised key definitions make cache invalidation straightforward:
 * invalidate `storageKeys.all` to clear every storage cache entry, or
 * `storageKeys.buckets()` to target the bucket list specifically.
 */
export const storageKeys = {
  all: ['storage'] as const,
  buckets: () => [...storageKeys.all, 'buckets'] as const
};
