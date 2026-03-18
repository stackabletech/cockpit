import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  getUserTrinoClient,
  setUserConnection,
  trinoMetadataQuery
} from '$lib/server/trino-clients.js';
import { trinoEnvConfigured, buildEnvConnectionConfig } from '$lib/server/trino-env-config.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const userId = getUserId(locals);
  let trinoClient = getUserTrinoClient(userId);

  if (!trinoClient && trinoEnvConfigured) {
    const config = buildEnvConnectionConfig(locals.user?.username ?? 'anonymous');
    setUserConnection(userId, config);
    trinoClient = getUserTrinoClient(userId)!;
  }

  if (!trinoClient) {
    error(400, 'No connection configured');
  }

  const level = url.searchParams.get('level');
  const catalog = url.searchParams.get('catalog');
  const schema = url.searchParams.get('schema');
  const table = url.searchParams.get('table');

  let sql: string;

  switch (level) {
    case 'catalogs':
      sql = 'SELECT catalog_name FROM system.metadata.catalogs ORDER BY catalog_name';
      break;
    case 'schemas':
      if (!catalog) error(400, 'catalog is required for schemas');
      sql = `SELECT schema_name FROM "${catalog}".information_schema.schemata ORDER BY schema_name`;
      break;
    case 'tables':
      if (!catalog || !schema) error(400, 'catalog and schema are required for tables');
      sql = `SELECT table_name, table_type FROM "${catalog}".information_schema.tables WHERE table_schema = '${schema}' ORDER BY table_name`;
      break;
    case 'columns':
      if (!catalog || !schema || !table)
        error(400, 'catalog, schema, and table are required for columns');
      sql = `SELECT column_name, data_type FROM "${catalog}".information_schema.columns WHERE table_schema = '${schema}' AND table_name = '${table}' ORDER BY ordinal_position`;
      break;
    default:
      error(400, 'level must be one of: catalogs, schemas, tables, columns');
  }

  try {
    log.debug({ level, catalog, schema, table }, 'fetching catalog metadata');
    const { rows } = await trinoMetadataQuery(trinoClient, sql);
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
