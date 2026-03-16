import { json, error } from '@sveltejs/kit';
import { trinoQuery, type AuthConfig } from '$lib/server/trino.js';
import type { RequestHandler } from './$types';

function parseAuth(url: URL): AuthConfig {
  const authType = url.searchParams.get('authType') ?? 'none';
  if (authType === 'basic') {
    return {
      type: 'basic',
      username: url.searchParams.get('authUsername') ?? '',
      password: url.searchParams.get('authPassword') ?? ''
    };
  }
  return { type: 'none' };
}

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;
  const level = url.searchParams.get('level');
  const connectionUrl = url.searchParams.get('connectionUrl');

  if (!connectionUrl) {
    error(400, 'connectionUrl is required');
  }

  const auth = parseAuth(url);
  const impersonation = url.searchParams.get('impersonation') === 'true';
  const impersonateUser = impersonation && locals.user?.username ? locals.user.username : undefined;
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
    const { rows } = await trinoQuery(connectionUrl, auth, sql, { impersonateUser });
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
