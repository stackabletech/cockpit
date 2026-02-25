import { json } from '@sveltejs/kit';
import * as m from '$lib/paraglide/messages.js';
import type { RequestHandler } from './$types';

const POLL_TIMEOUT_MS = 30_000;
const MAX_CACHED_ROWS = 100_000;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface TrinoColumn {
  name: string;
  type: string;
}

interface TrinoResponse {
  id?: string;
  nextUri?: string;
  columns?: TrinoColumn[];
  data?: unknown[][];
  stats?: { state: string };
  error?: { message: string; errorCode: number };
}

interface CacheEntry {
  columns: TrinoColumn[];
  rows: unknown[][];
  createdAt: number;
}

type AuthConfig = { type: 'none' } | { type: 'basic'; username: string; password: string };

interface ConnectionConfig {
  url: string;
  auth: AuthConfig;
}

const queryCache = new Map<string, CacheEntry>();

function evictStale() {
  const cutoff = Date.now() - CACHE_TTL_MS;
  for (const [id, entry] of queryCache) {
    if (entry.createdAt < cutoff) queryCache.delete(id);
  }
}

function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  if (auth.type === 'basic') {
    const encoded = Buffer.from(`${auth.username}:${auth.password}`).toString('base64');
    return {
      'X-Trino-User': auth.username,
      Authorization: `Basic ${encoded}`
    };
  }
  return { 'X-Trino-User': 'anonymous' };
}

async function trinoFetch(
  url: string,
  auth: AuthConfig,
  options?: RequestInit
): Promise<TrinoResponse> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...buildAuthHeaders(auth),
      'X-Trino-Source': 'stackable-ui',
      ...(options?.headers ?? {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Trino HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<TrinoResponse>;
}

function parseConnection(raw: unknown): ConnectionConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const conn = raw as Record<string, unknown>;
  const url = conn.url;
  if (typeof url !== 'string' || (!url.startsWith('http://') && !url.startsWith('https://'))) {
    return null;
  }
  const auth = conn.auth as Record<string, unknown> | undefined;
  if (!auth || typeof auth !== 'object') return null;
  if (auth.type === 'none') {
    return { url, auth: { type: 'none' } };
  }
  if (
    auth.type === 'basic' &&
    typeof auth.username === 'string' &&
    typeof auth.password === 'string'
  ) {
    return { url, auth: { type: 'basic', username: auth.username, password: auth.password } };
  }
  return null;
}

const ALLOWED_PAGE_SIZES = new Set([25, 50, 100]);

export const POST: RequestHandler = async ({ request, locals }) => {
  const log = locals.logger;

  const body = await request.json();
  const pageSize: number = ALLOWED_PAGE_SIZES.has(body.pageSize) ? body.pageSize : 25;
  const page: number = typeof body.page === 'number' && body.page >= 0 ? Math.floor(body.page) : 0;

  // Pagination: slice from server-side cache, no Trino re-execution.
  if (typeof body.queryId === 'string' && body.queryId) {
    const cached = queryCache.get(body.queryId);
    if (!cached) {
      log.info({ query_id: body.queryId }, 'cache miss (session expired)');
      return json({ error: 'session_expired' }, { status: 404 });
    }
    const start = page * pageSize;
    log.debug({ query_id: body.queryId, page, page_size: pageSize }, 'cache hit');
    return json({
      queryId: body.queryId,
      columns: cached.columns,
      rows: cached.rows.slice(start, start + pageSize),
      hasMore: start + pageSize < cached.rows.length,
      totalRows: cached.rows.length
    });
  }

  // New query execution — connection config required.
  const { sql } = body;
  if (!sql?.trim()) {
    return json({ error: m.trino_no_sql() }, { status: 400 });
  }

  const connection = parseConnection(body.connection);
  if (!connection) {
    return json({ error: m.trino_invalid_connection() }, { status: 400 });
  }

  evictStale();

  const queryStart = Date.now();
  log.info({ trino_url: connection.url }, 'executing query');

  const deadline = queryStart + POLL_TIMEOUT_MS;
  let columns: TrinoColumn[] = [];
  let rows: unknown[][] = [];

  try {
    let response = await trinoFetch(`${connection.url}/v1/statement`, connection.auth, {
      method: 'POST',
      body: sql.replace(/;\s*$/, '').trim(),
      headers: { 'Content-Type': 'text/plain' }
    });

    if (response.error) {
      log.info({ err: response.error }, 'query error');
      return json({ error: response.error.message }, { status: 400 });
    }

    if (response.columns) columns = response.columns;
    if (response.data) rows = rows.concat(response.data);

    while (response.nextUri && rows.length < MAX_CACHED_ROWS) {
      if (Date.now() > deadline) {
        log.info({ trino_url: connection.url, timeout_ms: POLL_TIMEOUT_MS }, 'query timed out');
        return json({ error: m.trino_query_timeout() }, { status: 408 });
      }

      response = await trinoFetch(response.nextUri, connection.auth);

      if (response.error) {
        log.info({ err: response.error }, 'query error');
        return json({ error: response.error.message }, { status: 400 });
      }

      if (response.columns && columns.length === 0) columns = response.columns;
      if (response.data) rows = rows.concat(response.data);
    }

    const queryId = crypto.randomUUID();
    queryCache.set(queryId, { columns, rows, createdAt: Date.now() });

    log.info(
      { query_id: queryId, rows: rows.length, cols: columns.length, duration_ms: Date.now() - queryStart },
      'query complete'
    );

    return json({
      queryId,
      columns,
      rows: rows.slice(0, pageSize),
      hasMore: rows.length > pageSize,
      totalRows: rows.length
    });
  } catch (err) {
    log.error({ err, trino_url: connection.url }, 'unexpected error');
    const message = err instanceof Error ? err.message : m.trino_unknown_error();
    return json({ error: message }, { status: 500 });
  }
};
