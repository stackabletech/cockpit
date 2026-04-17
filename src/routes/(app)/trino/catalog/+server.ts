import { json, error } from '@sveltejs/kit';
import { resolveTrinoClient, trinoMetadataQuery } from '$lib/server/trino/client.js';
import { getUserId } from '$lib/server/auth-utils.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;

  const userId = getUserId(locals);
  const client = resolveTrinoClient(userId);

  if (!client) {
    error(400, 'No Trino connection configured');
  }

  const user = locals.user?.username ?? 'anonymous';
  const level = url.searchParams.get('level');
  const catalog = url.searchParams.get('catalog');
  const schema = url.searchParams.get('schema');
  const table = url.searchParams.get('table');

  let sql: string;

  switch (level) {
    case 'catalogs':
      sql = 'SHOW CATALOGS';
      break;
    case 'schemas':
      if (!catalog) error(400, 'catalog is required for schemas');
      sql = `SHOW SCHEMAS FROM "${catalog}"`;
      break;
    case 'tables':
      if (!catalog || !schema) error(400, 'catalog and schema are required for tables');
      sql = `
        SELECT t.table_name,
               CASE WHEN mv.name IS NOT NULL THEN 'MATERIALIZED VIEW' ELSE t.table_type END AS table_type
        FROM "${catalog}".information_schema.tables t
        LEFT JOIN system.metadata.materialized_views mv
          ON mv.catalog_name = '${catalog}' AND mv.schema_name = t.table_schema AND mv.name = t.table_name
        WHERE t.table_schema = '${schema}'
        ORDER BY t.table_name`;
      break;
    case 'columns':
      if (!catalog || !schema || !table)
        error(400, 'catalog, schema, and table are required for columns');
      sql = `DESCRIBE "${catalog}"."${schema}"."${table}"`;
      break;
    default:
      error(400, 'level must be one of: catalogs, schemas, tables, columns');
  }

  try {
    log.debug({ level, catalog, schema, table }, 'fetching catalog metadata');
    const { rows } = await trinoMetadataQuery(client, sql, { user });
    log.debug(
      { level, catalog, schema, table, row_count: rows.length },
      'catalog metadata fetched'
    );
    return json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    log.info({ err, level, catalog, schema, table }, 'catalog metadata query failed');
    error(502, msg);
  }
};
