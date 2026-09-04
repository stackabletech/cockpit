import { error } from '@sveltejs/kit';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import {
  clearRecentSearches,
  listRecentSearches,
  recordRecentSearch,
  type RecentSearchOptions
} from '$lib/server/storage/recent-searches-db.js';
import { storageSearchHistoryTotal } from '$lib/server/metrics.js';
import type { RequestHandler } from './$types';

function connectionIdFromRequest(request: Request): string {
  const connectionId = request.headers.get(STORAGE_CONNECTION_ID_HEADER);
  if (!connectionId) {
    throw error(400, 'Missing storage connection ID');
  }
  return connectionId;
}

/** Lists the current user's recent searches for the active storage connection. */
export const GET: RequestHandler = async ({ request, locals }) => {
  const userId = locals.user!.id;
  const connectionId = connectionIdFromRequest(request);
  try {
    const searches = await listRecentSearches(userId, connectionId);
    storageSearchHistoryTotal.inc({ operation: 'list', outcome: 'success' });
    locals.logger.debug(
      { user_id: userId, connection_id: connectionId, search_count: searches.length },
      'recent storage searches returned'
    );
    return Response.json(searches);
  } catch (err) {
    storageSearchHistoryTotal.inc({ operation: 'list', outcome: 'error' });
    throw err;
  }
};

/** Records a submitted search, moving an identical search to the top. */
export const POST: RequestHandler = async ({ request, locals }) => {
  const userId = locals.user!.id;
  const connectionId = connectionIdFromRequest(request);
  const body = (await request.json()) as {
    buckets?: unknown;
    query?: unknown;
    useRegex?: unknown;
    excludePatterns?: unknown;
    searchPath?: unknown;
    maxDepth?: unknown;
  };
  const buckets = Array.isArray(body.buckets)
    ? [...new Set(body.buckets.map((b) => (typeof b === 'string' ? b.trim() : '')).filter(Boolean))]
    : [];
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (buckets.length === 0 || !query) {
    throw error(400, 'At least one bucket and a query are required');
  }
  const options: RecentSearchOptions = {
    useRegex: typeof body.useRegex === 'boolean' ? body.useRegex : false,
    excludePatterns:
      Array.isArray(body.excludePatterns) &&
      body.excludePatterns.every((i) => typeof i === 'string')
        ? body.excludePatterns
        : [],
    searchPath: typeof body.searchPath === 'string' ? body.searchPath.trim() : '',
    maxDepth:
      typeof body.maxDepth === 'number' && Number.isInteger(body.maxDepth) && body.maxDepth > 0
        ? body.maxDepth
        : null
  };

  try {
    await recordRecentSearch(userId, connectionId, buckets, query, options);
    storageSearchHistoryTotal.inc({ operation: 'record', outcome: 'success' });
    locals.logger.info(
      {
        user_id: userId,
        connection_id: connectionId,
        buckets,
        query,
        use_regex: options.useRegex,
        max_depth: options.maxDepth
      },
      'recent storage search recorded'
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    storageSearchHistoryTotal.inc({ operation: 'record', outcome: 'error' });
    throw err;
  }
};

/** Clears the current user's recent searches for the active storage connection. */
export const DELETE: RequestHandler = async ({ request, locals }) => {
  const userId = locals.user!.id;
  const connectionId = connectionIdFromRequest(request);
  try {
    await clearRecentSearches(userId, connectionId);
    storageSearchHistoryTotal.inc({ operation: 'clear', outcome: 'success' });
    locals.logger.info(
      { user_id: userId, connection_id: connectionId },
      'recent storage searches cleared'
    );
    return new Response(null, { status: 204 });
  } catch (err) {
    storageSearchHistoryTotal.inc({ operation: 'clear', outcome: 'error' });
    throw err;
  }
};
