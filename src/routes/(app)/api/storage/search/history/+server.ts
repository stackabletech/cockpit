import { error } from '@sveltejs/kit';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import {
  clearRecentSearches,
  listRecentSearches,
  recordRecentSearch
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
  const body = (await request.json()) as { bucket?: unknown; query?: unknown };
  const bucket = typeof body.bucket === 'string' ? body.bucket.trim() : '';
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (!bucket || !query) {
    throw error(400, 'Bucket and query are required');
  }

  try {
    await recordRecentSearch(userId, connectionId, bucket, query);
    storageSearchHistoryTotal.inc({ operation: 'record', outcome: 'success' });
    locals.logger.info(
      { user_id: userId, connection_id: connectionId, bucket, query },
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
