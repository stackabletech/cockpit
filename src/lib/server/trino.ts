export interface TrinoColumn {
  name: string;
  type: string;
}

export interface TrinoResponse {
  id?: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: unknown[][];
  stats?: { state: string };
  error?: { message: string; errorCode: number };
}

export interface CacheEntry {
  columns: TrinoColumn[];
  rows: unknown[][];
  createdAt: number;
}

export type AuthConfig = { type: 'none' } | { type: 'basic'; username: string; password: string };

export const POLL_TIMEOUT_MS = 30_000;
export const MAX_CACHED_ROWS = 100_000;
export const CACHE_TTL_MS = 5 * 60 * 1000;

export const queryCache = new Map<string, CacheEntry>();

export function evictStale() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [id, entry] of queryCache) {
    if (entry.createdAt < cutoff) queryCache.delete(id);
  }
}

export function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  if (auth.type === 'basic') {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
    return {
      'X-Trino-User': auth.username,
      Authorization: `Basic ${encoded}`
    };
  }
  return { 'X-Trino-User': 'anonymous' };
}

export async function trinoFetch(
  url: string,
  auth: AuthConfig,
  options?: RequestInit & { impersonateUser?: string }
): Promise<TrinoResponse> {
  const { impersonateUser, ...fetchOptions } = options ?? {};
  const headers: Record<string, string> = {
    ...buildAuthHeaders(auth),
    'X-Trino-Source': 'stackable-ui',
    ...((fetchOptions.headers as Record<string, string>) ?? {})
  };
  if (impersonateUser) {
    headers['X-Trino-User'] = impersonateUser;
  }
  const res = await fetch(url, {
    ...fetchOptions,
    headers
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trino HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<TrinoResponse>;
}
