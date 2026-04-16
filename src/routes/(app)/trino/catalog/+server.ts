import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  getMetadata,
  type MetadataLevel,
  type MetadataQuery
} from '$lib/server/trino/metadata-cache.js';
import type { RequestHandler } from './$types';

const LEVELS: MetadataLevel[] = ['catalogs', 'schemas', 'tables', 'columns', 'functions'];

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;

  const userId = getUserId(locals);
  const user = locals.user?.username ?? 'anonymous';

  const level = url.searchParams.get('level') as MetadataLevel | null;
  if (!level || !LEVELS.includes(level)) {
    error(400, 'level must be one of: catalogs, schemas, tables, columns, functions');
  }

  const q: MetadataQuery = {
    level,
    catalog: url.searchParams.get('catalog') ?? undefined,
    schema: url.searchParams.get('schema') ?? undefined,
    table: url.searchParams.get('table') ?? undefined
  };

  try {
    log.debug({ ...q }, 'fetching catalog metadata');
    const rows = await getMetadata(userId, user, q);
    log.debug({ ...q, row_count: rows.length }, 'catalog metadata fetched');
    return json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    log.info({ err, ...q }, 'catalog metadata query failed');
    error(502, msg);
  }
};
