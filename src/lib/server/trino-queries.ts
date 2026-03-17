import { logger } from '$lib/server/logging';
import { trinoActiveQueries, trinoQueryTotal } from '$lib/server/metrics.js';
import type { Trino, QueryResult } from 'trino-client';
import { isTerminal, type QuerySnapshot } from '$lib/types/query.js';
import {
  type TrinoQuery,
  toQueryState,
  toQueryProgress,
  terminateQuery
} from './trino-query-model.js';
import { getUserConfig } from './trino-clients.js';
import { collectResults } from './trino-result-collector.js';

const log = logger.child({ module: 'trino-queries' });

/** Current or most recently completed query per user. */
const activeQueries = new Map<string, TrinoQuery>();

function toSnapshot(query: TrinoQuery): QuerySnapshot {
  const config = getUserConfig(query.userId);
  const base = config?.connectionUrl.replace(/\/+$/, '');
  return {
    trinoQueryUrl: base ? `${base}/ui/query.html?${query.trinoQueryId}` : null,
    state: query.state,
    progress: query.progress,
    columns: query.columns,
    rows: query.rows,
    error: query.error,
    sql: query.sql,
    startedAt: query.startedAt
  };
}

/** Cancel the user's current query if it is still active. */
async function cancelTrinoQuery(userId: string): Promise<void> {
  const query = activeQueries.get(userId);
  if (!query || isTerminal(query.state)) return;

  log.info({ trino_query_id: query.trinoQueryId, user_id: userId }, 'cancelling previous query');
  try {
    await query.trinoClient.cancel(query.trinoQueryId);
  } catch (err) {
    log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel query in Trino');
  }
  // Always terminate locally so the poll loop stops and the gauge is decremented,
  // even if the remote cancel RPC failed.
  terminateQuery(query, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
}

// --- Public API ---

export async function startQuery(userId: string, sql: string, trinoClient: Trino): Promise<string> {
  // Cancel existing active query for this user (single-query limit).
  await cancelTrinoQuery(userId);

  // Trino's REST API rejects SQL ending with a semicolon.
  const cleanSql = sql.replace(/;\s*$/, '').trim();

  log.info({ user_id: userId }, 'submitting query');
  trinoQueryTotal.inc({ outcome: 'submitted' });

  const iterator = await trinoClient.query({ query: cleanSql });

  // Process the first result to get the query ID.
  const firstResult = await iterator.next();
  const result: QueryResult = firstResult.value;

  const trinoQueryId = result.id;
  if (!trinoQueryId) {
    throw new Error('Trino did not return a query ID');
  }

  const query: TrinoQuery = {
    trinoQueryId,
    state: result.stats ? toQueryState(result.stats.state) : 'QUEUED',
    progress: toQueryProgress(result.stats),
    columns: result.columns ?? [],
    rows: result.data ?? [],
    error: null,
    sql: cleanSql,
    startedAt: Date.now(),
    iterator,
    trinoClient,
    userId,
    completedAt: null
  };

  if (result.error) {
    query.error = result.error.message ?? 'Query failed';
    terminateQuery(query, 'FAILED', { wasActive: false });
    trinoQueryTotal.inc({ outcome: 'failed' });
  }

  activeQueries.set(userId, query);

  if (!isTerminal(query.state) && !firstResult.done) {
    trinoActiveQueries.inc();
    // Fire-and-forget — the poll loop runs independently.
    collectResults(query).catch((err) => {
      log.error({ err, trino_query_id: trinoQueryId }, 'poll loop crashed');
      if (!isTerminal(query.state)) {
        query.error = 'Internal poll error';
        terminateQuery(query, 'FAILED');
        trinoQueryTotal.inc({ outcome: 'failed' });
      }
    });
  } else if (!isTerminal(query.state)) {
    // Iterator already done (no more data) — mark finished.
    terminateQuery(query, 'FINISHED', { wasActive: false });
  }

  log.info({ trino_query_id: trinoQueryId, user_id: userId }, 'query started');
  return trinoQueryId;
}

export function getQuerySnapshot(userId: string): QuerySnapshot | null {
  const query = activeQueries.get(userId);
  if (!query) return null;
  return toSnapshot(query);
}

export async function cancelQuery(userId: string): Promise<boolean> {
  const query = activeQueries.get(userId);
  if (!query || isTerminal(query.state)) return false;

  log.info({ trino_query_id: query.trinoQueryId, user_id: userId }, 'cancelling query');

  try {
    await query.trinoClient.cancel(query.trinoQueryId);
  } catch (err) {
    log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel query in Trino');
  }

  terminateQuery(query, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
  return true;
}
