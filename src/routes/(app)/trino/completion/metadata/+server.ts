import { json, error } from '@sveltejs/kit';
import { resolveTrinoClient, trinoMetadataQuery } from '$lib/server/trino/client.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { completionEnabled } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';

type Level = 'catalogs' | 'schemas' | 'tables' | 'columns' | 'functions';

const LEVELS: Level[] = ['catalogs', 'schemas', 'tables', 'columns', 'functions'];

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;

  if (!completionEnabled) {
    error(404, 'Code completion is disabled');
  }

  const userId = getUserId(locals);
  const client = resolveTrinoClient(userId);

  if (!client) {
    error(400, 'No Trino connection configured');
  }

  const user = locals.user?.username ?? 'anonymous';
  const level = url.searchParams.get('level') as Level | null;
  const catalog = url.searchParams.get('catalog');
  const schema = url.searchParams.get('schema');
  const table = url.searchParams.get('table');

  if (!level || !LEVELS.includes(level)) {
    error(400, 'level must be one of: catalogs, schemas, tables, columns, functions');
  }

  let sql: string;
  const opts: { user: string; catalog?: string; schema?: string } = { user };

  switch (level) {
    case 'catalogs':
      sql = 'SHOW CATALOGS';
      break;
    case 'schemas':
      if (!catalog) error(400, 'catalog is required for schemas');
      sql = 'SHOW SCHEMAS';
      opts.catalog = catalog;
      break;
    case 'tables':
      if (!catalog || !schema) error(400, 'catalog and schema are required for tables');
      sql = `SELECT t.table_name, CASE WHEN mv.name IS NOT NULL THEN 'MATERIALIZED VIEW' ELSE t.table_type END AS table_type FROM information_schema.tables t LEFT JOIN system.metadata.materialized_views mv ON mv.catalog_name = CURRENT_CATALOG AND mv.schema_name = t.table_schema AND mv.name = t.table_name WHERE t.table_schema = '${schema}' ORDER BY t.table_name`;
      opts.catalog = catalog;
      break;
    case 'columns':
      if (!catalog || !schema || !table)
        error(400, 'catalog, schema, and table are required for columns');
      sql = `DESCRIBE "${table}"`;
      opts.catalog = catalog;
      opts.schema = schema;
      break;
    case 'functions':
      sql = 'SELECT DISTINCT lower("Function") FROM (SHOW FUNCTIONS) ORDER BY 1';
      break;
  }

  try {
    log.debug({ level, catalog, schema, table }, 'fetching completion metadata');
    const { rows } = await trinoMetadataQuery(client, sql, opts);

    if (level === 'tables') {
      const entries = rows.map((r) => {
        const raw = String((r as string[])[1] ?? '').toUpperCase();
        return {
          name: String((r as string[])[0]),
          kind:
            raw === 'MATERIALIZED VIEW'
              ? 'materialized_view'
              : raw === 'VIEW'
                ? 'view'
                : 'table'
        };
      });
      return json(entries);
    }

    const names = rows.map((r) => String((r as string[])[0]));
    log.debug({ level, catalog, schema, table, count: names.length }, 'completion metadata fetched');
    return json(names);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    log.info({ err, level, catalog, schema, table }, 'completion metadata query failed');
    error(502, msg);
  }
};
