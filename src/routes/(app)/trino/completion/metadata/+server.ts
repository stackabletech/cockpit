import { json, error } from '@sveltejs/kit';
import { getUserId } from '$lib/server/auth-utils.js';
import {
  getMetadataNames,
  getMetadataTables,
  type MetadataLevel,
  type MetadataQuery
} from '$lib/server/trino/metadata-cache.js';
import { completionEnabled } from '$lib/server/feature-flags.js';
import type { RequestHandler } from './$types';

const LEVELS: MetadataLevel[] = ['catalogs', 'schemas', 'tables', 'columns', 'functions'];

export const GET: RequestHandler = async ({ url, locals }) => {
  const log = locals.logger;

  if (!completionEnabled) {
    error(404, 'Code completion is disabled');
  }

  const level = url.searchParams.get('level') as MetadataLevel | null;
  if (!level || !LEVELS.includes(level)) {
    error(400, 'level must be one of: catalogs, schemas, tables, columns');
  }

  const q: MetadataQuery = {
    level,
    catalog: url.searchParams.get('catalog') ?? undefined,
    schema: url.searchParams.get('schema') ?? undefined,
    table: url.searchParams.get('table') ?? undefined
  };

  const userId = getUserId(locals);
  const user = locals.user?.username ?? 'anonymous';

  try {
    // Tables need a `kind` (table / view / materialized_view) so the editor can
    // render a distinct icon and detail — other levels are plain name lists.
    if (q.level === 'tables') {
      if (!q.catalog || !q.schema) {
        error(400, 'catalog and schema are required for tables');
      }
      const entries = await getMetadataTables(userId, user, q.catalog, q.schema);
      log.debug({ ...q, count: entries.length }, 'completion metadata fetched');
      return json(entries);
    }
    const names = await getMetadataNames(userId, user, q);
    log.debug({ ...q, count: names.length }, 'completion metadata fetched');
    return json(names);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown error';
    log.info({ err, ...q }, 'completion metadata query failed');
    error(502, msg);
  }
};
