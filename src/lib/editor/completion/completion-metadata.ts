// Typed client for GET /api/trino/completion/metadata with a short-lived in-memory
// cache. Used by the Monaco completion provider; kept provider-agnostic so it
// can be shared by other callers that need the same metadata.

export type TableKind = 'table' | 'view' | 'materialized_view';

export interface TableEntry {
  name: string;
  kind: TableKind;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const CLIENT_CACHE_TTL_MS = 5 * 60_000;
const CLIENT_CACHE_SWEEP_MS = 5 * 60_000;
const clientCache = new Map<string, CacheEntry<unknown> | Promise<unknown>>();

/** Drop all cached metadata so the next completion fetches fresh data. */
export function clearCompletionCache(): void {
  clientCache.clear();
}

// Periodic sweep of expired entries to prevent unbounded growth.
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clientCache.entries()) {
      if (!(entry instanceof Promise) && entry.expiresAt <= now) {
        clientCache.delete(key);
      }
    }
  }, CLIENT_CACHE_SWEEP_MS);
}

type NameLevel = 'catalogs' | 'schemas' | 'columns' | 'functions';

async function fetchCached<T>(cacheKey: string, qs: URLSearchParams, empty: T): Promise<T> {
  const now = Date.now();
  const hit = clientCache.get(cacheKey);
  if (hit) {
    if (hit instanceof Promise) return hit as Promise<T>;
    if (hit.expiresAt > now) return hit.value as T;
  }

  const promise = (async () => {
    const res = await fetch(`/api/trino/completion/metadata?${qs.toString()}`);
    if (!res.ok) return empty;
    const value = (await res.json()) as T;
    clientCache.set(cacheKey, { value, expiresAt: Date.now() + CLIENT_CACHE_TTL_MS });
    return value;
  })();

  clientCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch {
    clientCache.delete(cacheKey);
    return empty;
  }
}

export async function fetchNames(params: {
  level: NameLevel;
  catalog?: string;
  schema?: string;
  table?: string;
}): Promise<string[]> {
  const key = `${params.level}:${params.catalog ?? ''}:${params.schema ?? ''}:${params.table ?? ''}`;
  const qs = new URLSearchParams({ level: params.level });
  if (params.catalog) qs.set('catalog', params.catalog);
  if (params.schema) qs.set('schema', params.schema);
  if (params.table) qs.set('table', params.table);
  return fetchCached<string[]>(key, qs, []);
}

export async function fetchTables(catalog: string, schema?: string): Promise<TableEntry[]> {
  const key = `tables:${catalog}:${schema ?? ''}:`;
  const qs = new URLSearchParams({ level: 'tables', catalog, ...(schema ? { schema } : {}) });
  return fetchCached<TableEntry[]>(key, qs, []);
}
