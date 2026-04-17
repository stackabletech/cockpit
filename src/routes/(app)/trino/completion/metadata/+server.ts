import { json, error } from '@sveltejs/kit';
import { z } from 'zod';
import { resolveTrinoClient, trinoMetadataQuery } from '$lib/server/trino/client.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { completionEnabled } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';

const safeIdentifier = z.string().regex(/^[a-zA-Z0-9_]+$/, 'must be a valid identifier');

const ParamsSchema = z.object({
  level: z.enum(['catalogs', 'schemas', 'tables', 'columns', 'functions']),
  catalog: safeIdentifier.optional(),
  schema: safeIdentifier.optional(),
  table: safeIdentifier.optional()
});

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
  const raw = Object.fromEntries(url.searchParams.entries());
  const parsed = ParamsSchema.safeParse(raw);

  if (!parsed.success) {
    error(400, parsed.error.issues.map((i) => i.message).join('; '));
  }

  const { level, catalog, schema, table } = parsed.data;

  let sql: string;
  const opts: { user: string; catalog?: string; schema?: string } = { user };

  switch (level) {
    case 'catalogs':
      sql = 'SHOW CATALOGS';
      break;
    case 'schemas':
      sql = 'SHOW SCHEMAS';
      opts.catalog = catalog;
      break;
    case 'tables': {
      const schemaFilter = schema ? `WHERE t.table_schema = '${schema}'` : '';
      sql = `
        SELECT
          t.table_name,
          CASE
            WHEN mv.name IS NOT NULL THEN 'MATERIALIZED VIEW'
            ELSE t.table_type
          END AS table_type
        FROM information_schema.tables t
        LEFT JOIN system.metadata.materialized_views mv
          ON mv.catalog_name = CURRENT_CATALOG
         AND mv.schema_name = t.table_schema
         AND mv.name = t.table_name
        ${schemaFilter}
        ORDER BY t.table_name
      `;
      opts.catalog = catalog;
      break;
    }
    case 'columns':
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
        const rawType = String((r as string[])[1] ?? '').toUpperCase();
        return {
          name: String((r as string[])[0]),
          kind:
            rawType === 'MATERIALIZED VIEW'
              ? 'materialized_view'
              : rawType === 'VIEW'
                ? 'view'
                : 'table'
        };
      });
      log.debug(
        { level, catalog, schema, count: entries.length },
        'completion metadata fetched'
      );
      return json(entries);
    }

    const names = rows.map((r) => String((r as string[])[0]));
    log.debug(
      { level, catalog, schema, table, count: names.length },
      'completion metadata fetched'
    );
    return json(names);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    log.info({ err, level, catalog, schema, table }, 'completion metadata query failed');
    error(502, msg);
  }
};
