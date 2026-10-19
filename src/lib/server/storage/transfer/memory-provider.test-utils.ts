import { error } from '@sveltejs/kit';
import { vi } from 'vitest';
import type { CopyObjectOptions, StorageProvider } from '../provider.js';

/** Object sizes by key, per bucket. */
export type MemoryStore = Map<string, Map<string, number>>;

export function memoryStore(
  buckets: Record<string, Record<string, number> | string[]>
): MemoryStore {
  return new Map(
    Object.entries(buckets).map(([bucket, objects]) => [
      bucket,
      new Map(Array.isArray(objects) ? objects.map((key) => [key, 1]) : Object.entries(objects))
    ])
  );
}

function abortError(): Error {
  return Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}

/**
 * A bucket-scoped provider over an in-memory store, implementing just what the
 * transfer engine uses. Every method is a spy so tests can wrap or inspect it.
 */
export function memoryProvider(store: MemoryStore, bucket: string) {
  const objects = () => {
    let map = store.get(bucket);
    if (!map) store.set(bucket, (map = new Map()));
    return map;
  };
  const provider = {
    exists: vi.fn(async (key: string) => objects().has(key)),
    prefixExists: vi.fn(async (prefix: string) =>
      [...objects().keys()].some((key) => key.startsWith(prefix))
    ),
    getMetadata: vi.fn(async (key: string) => {
      const size = objects().get(key);
      if (size === undefined) throw error(404, `Object "${key}" not found`);
      return { size, lastModified: new Date(0) };
    }),
    listAllKeysProgressively: vi.fn(
      async (
        prefix: string,
        onBatch: (batch: Array<{ key: string; size: number }>) => void | boolean,
        options?: { signal?: AbortSignal }
      ) => {
        if (options?.signal?.aborted) throw abortError();
        const batch = [...objects()]
          .filter(([key]) => key.startsWith(prefix))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, size]) => ({ key, size }));
        if (batch.length > 0) onBatch(batch);
      }
    ),
    copyObject: vi.fn(async (sourceKey: string, destKey: string, options?: CopyObjectOptions) => {
      if (options?.signal?.aborted) throw abortError();
      const size = store.get(options?.sourceBucket ?? bucket)?.get(sourceKey);
      if (size === undefined) throw error(404, `Object "${sourceKey}" not found`);
      objects().set(destKey, size);
    }),
    deleteObjects: vi.fn(async (keys: string[], expandDirectories: boolean) => {
      if (expandDirectories) throw new Error('the engine must never expand directories');
      for (const key of keys) objects().delete(key);
      return { failed: [] as Array<{ key: string; code?: string; message?: string }> };
    })
  };
  return provider as typeof provider & StorageProvider;
}

/** The sorted keys of a bucket. */
export function keysOf(store: MemoryStore, bucket: string): string[] {
  return [...(store.get(bucket)?.keys() ?? [])].sort();
}
