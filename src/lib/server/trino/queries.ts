import { logger } from '$lib/server/logging';
import { trinoActiveQueries, trinoQueryTotal } from '$lib/server/metrics.js';
import {
  INITIAL_PROGRESS,
  isTerminal,
  type Column,
  type QueryProgress,
  type QuerySnapshot,
  type QueryState
} from '$lib/types/query.js';
import { type TrinoClient, type TrinoQueryStats, resolveTrinoServerUrl } from './client.js';
import { collectResults } from './result-collector.js';

const log = logger.child({ module: 'trino-queries' });

// --- TrinoQuery model ---

export interface TrinoQuery {
  trinoQueryId: string;
  state: QueryState;
  progress: QueryProgress;
  columns: Column[];
  rows: unknown[][];
  error: string | null;
  sql: string;
  startedAt: number;
  nextUri: string | undefined;
  client: TrinoClient;
  userId: string;
  completedAt: number | null;
}

const TRINO_STATES = new Set(['QUEUED', 'PLANNING', 'RUNNING', 'FINISHING', 'FINISHED', 'FAILED']);

export function mapTrinoState(trinoState: string | undefined): QueryState {
  if (trinoState && TRINO_STATES.has(trinoState)) {
    return trinoState as QueryState;
  }
  return 'RUNNING'; // STARTING & unknown states are mapped to RUNNING
}

export function toQueryProgress(stats: TrinoQueryStats | undefined): QueryProgress {
  if (!stats) return INITIAL_PROGRESS;
  return {
    progressPercentage: stats.progressPercentage ?? 0,
    processedRows: stats.processedRows ?? 0,
    elapsedTimeMillis: stats.elapsedTimeMillis ?? 0
  };
}

// Idempotent: the poll loop and external cancellation may both attempt to
// terminate — only the first call decrements the gauge.
// Pass decrementGauge: false for paths that never called trinoActiveQueries.inc()
// (e.g. submit error, no nextUri).
export function terminateQuery(
  query: TrinoQuery,
  state: QueryState,
  { decrementGauge = true } = {}
) {
  if (query.completedAt !== null) return;
  query.state = state;
  query.completedAt = Date.now();
  if (decrementGauge) trinoActiveQueries.dec();
}

// --- Active query store ---

/** All queries for a tab (ordered by execution). */
const userQueries = new Map<string, Map<string, TrinoQuery[]>>();

function getUserTabMap(userId: string): Map<string, TrinoQuery[]> {
  let tabMap = userQueries.get(userId);
  if (!tabMap) {
    tabMap = new Map();
    userQueries.set(userId, tabMap);
  }
  return tabMap;
}

function getTabQueries(userId: string, tabId: string): TrinoQuery[] {
  const tabMap = userQueries.get(userId);
  return tabMap?.get(tabId) ?? [];
}

/** Returns the currently active (non-terminal) query for a tab, if any. */
function getActiveQuery(userId: string, tabId: string): TrinoQuery | undefined {
  const queries = getTabQueries(userId, tabId);
  const last = queries[queries.length - 1];
  return last && !isTerminal(last.state) ? last : undefined;
}

function buildSnapshot(
  query: TrinoQuery,
  trinoServerUrl: string | null,
  lightweight = false
): QuerySnapshot {
  return {
    trinoQueryUrl: trinoServerUrl ? `${trinoServerUrl}/ui/query.html?${query.trinoQueryId}` : null,
    state: query.state,
    progress: query.progress,
    columns: lightweight ? [] : query.columns,
    rows: lightweight ? [] : query.rows,
    error: query.error,
    sql: query.sql,
    startedAt: query.startedAt
  };
}

/** Cancel the active query for a specific tab if it is still running. */
async function cancelActiveTabQuery(userId: string, tabId: string): Promise<void> {
  const query = getActiveQuery(userId, tabId);
  if (!query) return;

  log.info(
    { trino_query_id: query.trinoQueryId, user_id: userId, tab_id: tabId },
    'cancelling previous query for tab'
  );
  try {
    await query.client.cancel(query.trinoQueryId);
  } catch (err) {
    log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel query in Trino');
  }
  terminateQuery(query, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
}

// --- Public API ---

/** Clear all stored results for a tab and cancel any active query. */
export async function resetTabQueries(userId: string, tabId: string): Promise<void> {
  await cancelActiveTabQuery(userId, tabId);
  const tabMap = getUserTabMap(userId);
  tabMap.set(tabId, []);
}

export async function startQuery(
  client: TrinoClient,
  userId: string,
  tabId: string,
  sql: string,
  options: { user: string; catalog?: string; schema?: string }
): Promise<string> {
  // Cancel existing active query for this tab (but keep completed results).
  await cancelActiveTabQuery(userId, tabId);

  // Trino's REST API rejects SQL ending with a semicolon.
  const sanitisedSql = sql.replace(/;\s*$/, '').trim();

  log.info({ user_id: userId, tab_id: tabId }, 'submitting query');
  trinoQueryTotal.inc({ outcome: 'submitted' });
  let submitResult;
  try {
    submitResult = await client.submit(sanitisedSql, options);
  } catch (err) {
    trinoQueryTotal.inc({ outcome: 'failed' });
    throw err;
  }

  const trinoQueryId = submitResult.id;
  if (!trinoQueryId) {
    throw new Error('Trino did not return a query ID');
  }

  const query: TrinoQuery = {
    trinoQueryId,
    state: submitResult.stats ? mapTrinoState(submitResult.stats.state) : 'QUEUED',
    progress: toQueryProgress(submitResult.stats),
    columns: submitResult.columns ?? [],
    rows: submitResult.data ?? [],
    error: null,
    sql: sanitisedSql,
    startedAt: Date.now(),
    nextUri: submitResult.nextUri,
    client,
    userId,
    completedAt: null
  };

  if (submitResult.error) {
    query.error = submitResult.error.message ?? 'Query failed';
    terminateQuery(query, 'FAILED', { decrementGauge: false });
    trinoQueryTotal.inc({ outcome: 'failed' });
  }

  const tabMap = getUserTabMap(userId);
  const queries = tabMap.get(tabId) ?? [];
  queries.push(query);
  tabMap.set(tabId, queries);

  if (!isTerminal(query.state) && query.nextUri) {
    trinoActiveQueries.inc();
    // Fire-and-forget — the poll loop runs independently.
    collectResults(query).catch((err) => {
      log.error({ err, trino_query_id: trinoQueryId }, 'poll loop crashed');
      // Skip if already terminated by cancelQuery during the poll.
      if (!isTerminal(query.state)) {
        query.error = 'Internal poll error';
        terminateQuery(query, 'FAILED');
        trinoQueryTotal.inc({ outcome: 'failed' });
      }
    });
  } else if (!isTerminal(query.state)) {
    // No more pages — query already complete.
    terminateQuery(query, 'FINISHED', { decrementGauge: false });
    trinoQueryTotal.inc({ outcome: 'completed' });
  }

  log.info({ trino_query_id: trinoQueryId, user_id: userId, tab_id: tabId }, 'query started');
  return trinoQueryId;
}

/** Returns snapshots for all queries in a tab (completed + active). */
export function getQuerySnapshots(userId: string, tabId: string): QuerySnapshot[] {
  const trinoServerUrl = resolveTrinoServerUrl(userId);
  return getTabQueries(userId, tabId).map((q) => buildSnapshot(q, trinoServerUrl));
}

/** Lightweight summaries without rows/columns — used for SSR to keep the payload small. */
export function getAllQuerySummaries(userId: string): Record<string, QuerySnapshot[]> {
  const tabMap = userQueries.get(userId);
  if (!tabMap) return {};
  const trinoServerUrl = resolveTrinoServerUrl(userId);
  const result: Record<string, QuerySnapshot[]> = {};
  for (const [tabId, queries] of tabMap) {
    result[tabId] = queries.map((q) => buildSnapshot(q, trinoServerUrl, true));
  }
  return result;
}

/** Remove the stored query state for a tab (frees memory). */
export function removeTabQuery(userId: string, tabId: string): void {
  const tabMap = userQueries.get(userId);
  if (!tabMap) return;
  tabMap.delete(tabId);
  if (tabMap.size === 0) {
    userQueries.delete(userId);
  }
}

export async function cancelQuery(userId: string, tabId: string): Promise<boolean> {
  const query = getActiveQuery(userId, tabId);
  if (!query) return false;

  log.info(
    { trino_query_id: query.trinoQueryId, user_id: userId, tab_id: tabId },
    'cancelling query'
  );

  try {
    await query.client.cancel(query.trinoQueryId);
  } catch (err) {
    log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel query in Trino');
  }

  terminateQuery(query, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
  return true;
}
