// Per-user, short-TTL cache of Trino metadata (catalogs, schemas, tables,
// columns). Used by both the catalog browser and the editor's completion
// provider. Entries are invalidated proactively by DDL detection (see
// ./ddl-invalidation.ts) and passively by TTL.

import { env } from '$env/dynamic/private';
import { logger } from '$lib/server/logging';
import { resolveTrinoClient, trinoMetadataQuery } from './client.js';

const log = logger.child({ module: 'trino-metadata-cache' });

/** Default TTL in seconds. Kept short so stale entries auto-heal between
 *  completion keystrokes even if DDL detection misses something. */
const METADATA_TTL_SEC = Number(env.STACKABLE_UI_METADATA_TTL) || 60;
const SWEEP_INTERVAL_MS = 60_000;

export type MetadataLevel = 'catalogs' | 'schemas' | 'tables' | 'columns' | 'functions';

export interface MetadataQuery {
  level: MetadataLevel;
  catalog?: string;
  schema?: string;
  table?: string;
}

interface Entry {
  rows: unknown[][];
  expiresAt: number;
}

/** userId → cacheKey → entry. */
const cache = new Map<string, Map<string, Entry>>();
/** In-flight request de-duplication per user + key. */
const inflight = new Map<string, Map<string, Promise<unknown[][]>>>();

function getUserMap<V>(store: Map<string, Map<string, V>>, userId: string): Map<string, V> {
  let m = store.get(userId);
  if (!m) {
    m = new Map();
    store.set(userId, m);
  }
  return m;
}

function cacheKey(q: MetadataQuery): string {
  switch (q.level) {
    case 'catalogs':
      return 'catalogs';
    case 'schemas':
      return `schemas:${q.catalog}`;
    case 'tables':
      return `tables:${q.catalog}.${q.schema ?? '*'}`;
    case 'columns':
      return `columns:${q.catalog}.${q.schema ?? '*'}.${q.table ?? '*'}`;
    case 'functions':
      return 'functions';
  }
}

/** Escape a value for use inside a single-quoted SQL string literal. */
function escapeString(value: string): string {
  return value.replaceAll("'", "''");
}

/** Wrap a value in double-quoted SQL identifier escaping. */
function escapeIdentifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"';
}

interface BuiltQuery {
  sql: string;
  /** Catalog to set via X-Trino-Catalog session header. */
  catalog?: string;
  /** Schema to set via X-Trino-Schema session header. */
  schema?: string;
}

function buildQuery(q: MetadataQuery): BuiltQuery {
  switch (q.level) {
    case 'catalogs':
      return { sql: 'SHOW CATALOGS' };
    case 'schemas':
      if (!q.catalog) throw new Error('catalog is required for schemas');
      return { sql: 'SHOW SCHEMAS', catalog: q.catalog };
    case 'tables': {
      // SHOW TABLES cannot distinguish tables from views — information_schema
      // is the only option. LEFT JOIN system.metadata.materialized_views to
      // reclassify materialized views (reported as 'BASE TABLE' by
      // information_schema). CURRENT_CATALOG resolves to the session catalog.
      if (!q.catalog) throw new Error('catalog is required for tables');
      const where = q.schema ? ` WHERE t.table_schema = '${escapeString(q.schema)}'` : '';
      return {
        sql:
          'SELECT t.table_name,' +
          " CASE WHEN mv.name IS NOT NULL THEN 'MATERIALIZED VIEW' ELSE t.table_type END AS table_type" +
          ' FROM information_schema.tables t' +
          ' LEFT JOIN system.metadata.materialized_views mv' +
          ' ON mv.catalog_name = CURRENT_CATALOG AND mv.schema_name = t.table_schema AND mv.name = t.table_name' +
          where +
          ' ORDER BY t.table_name',
        catalog: q.catalog
      };
    }
    case 'columns': {
      if (!q.catalog) throw new Error('catalog is required for columns');
      // SHOW COLUMNS FROM <table> — returns column name + data type via session
      // catalog/schema headers, no string interpolation needed.
      if (q.table) {
        return {
          sql: `SHOW COLUMNS FROM ${escapeIdentifier(q.table)}`,
          catalog: q.catalog,
          schema: q.schema
        };
      }
      // Without a specific table, fall back to information_schema to list all
      // columns in the schema.
      const conditions: string[] = [];
      if (q.schema) conditions.push(`table_schema = '${escapeString(q.schema)}'`);
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
      return {
        sql: `SELECT column_name, data_type FROM information_schema.columns${where} ORDER BY ordinal_position`,
        catalog: q.catalog
      };
    }
    case 'functions':
      // SHOW FUNCTIONS returns one row per overload; collapse to the distinct
      // lower-cased name so we don't suggest the same function 5×.
      return { sql: 'SELECT DISTINCT lower("Function") FROM (SHOW FUNCTIONS) ORDER BY 1' };
  }
}

/** Fetch metadata for the given query, cached per user. Returns the full
 *  result rows — callers extract the columns they need. */
export async function getMetadata(
  userId: string,
  user: string,
  q: MetadataQuery
): Promise<unknown[][]> {
  const key = cacheKey(q);
  const now = Date.now();

  const userCache = getUserMap(cache, userId);
  const hit = userCache.get(key);
  if (hit && hit.expiresAt > now) {
    return hit.rows;
  }

  const userInflight = getUserMap(inflight, userId);
  const existing = userInflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const client = resolveTrinoClient(userId);
    if (!client) throw new Error('No Trino connection configured');
    const { sql, catalog, schema } = buildQuery(q);
    const { rows } = await trinoMetadataQuery(client, sql, { user, catalog, schema });
    userCache.set(key, {
      rows,
      expiresAt: Date.now() + METADATA_TTL_SEC * 1000
    });
    return rows;
  })();

  userInflight.set(key, promise);
  try {
    return await promise;
  } finally {
    userInflight.delete(key);
  }
}

/** Convenience: fetch metadata and return only the first column as strings. */
export async function getMetadataNames(
  userId: string,
  user: string,
  q: MetadataQuery
): Promise<string[]> {
  const rows = await getMetadata(userId, user, q);
  return rows.map((r) => String(r[0]));
}

export type TableKind = 'table' | 'view' | 'materialized_view';

export interface TableEntry {
  name: string;
  kind: TableKind;
}

function classifyTableType(raw: string): TableKind {
  const upper = raw.toUpperCase();
  if (upper === 'MATERIALIZED VIEW') return 'materialized_view';
  if (upper === 'VIEW') return 'view';
  return 'table';
}

/** Fetch the table list for a schema as {name, kind} entries. The kind column
 *  comes from information_schema.tables + system.metadata.materialized_views
 *  (see `buildQuery` for the `tables` level). */
export async function getMetadataTables(
  userId: string,
  user: string,
  catalog: string,
  schema: string
): Promise<TableEntry[]> {
  const rows = await getMetadata(userId, user, { level: 'tables', catalog, schema });
  return rows.map((r) => ({
    name: String(r[0]),
    kind: classifyTableType(String(r[1] ?? ''))
  }));
}

/** Drop all cache entries for the user whose key starts with the given prefix.
 *  Prefixes follow the `cacheKey` format, e.g. `'schemas:mycat'` or
 *  `'tables:mycat.mysch'` or `'columns:mycat.mysch.mytab'` — or the
 *  higher-level `'catalogs'`, `'schemas:'`, `'tables:'`, `'columns:'`. */
export function invalidate(userId: string, ...prefixes: string[]): void {
  const userCache = cache.get(userId);
  if (!userCache) return;
  let dropped = 0;
  for (const key of userCache.keys()) {
    if (prefixes.some((p) => key === p || key.startsWith(p))) {
      userCache.delete(key);
      dropped++;
    }
  }
  if (dropped > 0) {
    log.debug({ user_id: userId, prefixes, dropped }, 'invalidated metadata cache entries');
  }
}

/** Periodic sweep of expired entries. */
function sweep(): void {
  const now = Date.now();
  let dropped = 0;
  for (const [userId, userCache] of cache.entries()) {
    for (const [key, entry] of userCache.entries()) {
      if (entry.expiresAt <= now) {
        userCache.delete(key);
        dropped++;
      }
    }
    if (userCache.size === 0) cache.delete(userId);
  }
  if (dropped > 0) {
    log.trace({ dropped }, 'swept expired metadata cache entries');
  }
}

let sweeper: ReturnType<typeof setInterval> | null = null;
if (typeof setInterval !== 'undefined') {
  sweeper = setInterval(sweep, SWEEP_INTERVAL_MS);
  if (typeof sweeper === 'object' && sweeper !== null && 'unref' in sweeper) {
    (sweeper as { unref?: () => void }).unref?.();
  }
}

/** Test hook: drop all state. */
export function _resetMetadataCache(): void {
  cache.clear();
  inflight.clear();
}
