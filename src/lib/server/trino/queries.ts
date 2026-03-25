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

/** Current or most recently completed query per user. */
const userQueries = new Map<string, TrinoQuery>();

function buildSnapshot(query: TrinoQuery): QuerySnapshot {
  const trinoServerUrl = resolveTrinoServerUrl(query.userId);
  return {
    trinoQueryUrl: trinoServerUrl ? `${trinoServerUrl}/ui/query.html?${query.trinoQueryId}` : null,
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
async function cancelPreviousQuery(userId: string): Promise<void> {
  const query = userQueries.get(userId);
  if (!query || isTerminal(query.state)) return;

  log.info({ trino_query_id: query.trinoQueryId, user_id: userId }, 'cancelling previous query');
  try {
    await query.client.cancel(query.trinoQueryId);
  } catch (err) {
    log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel query in Trino');
  }
  // Always terminate locally so the poll loop stops and the gauge is decremented,
  // even if the remote cancel RPC failed.
  terminateQuery(query, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
}

// --- Public API ---

export async function startQuery(
  client: TrinoClient,
  userId: string,
  sql: string,
  options: { user: string; catalog?: string; schema?: string }
): Promise<string> {
  // Cancel existing active query for this user (single-query limit).
  await cancelPreviousQuery(userId);

  // Trino's REST API rejects SQL ending with a semicolon.
  const sanitisedSql = sql.replace(/;\s*$/, '').trim();

  log.info({ user_id: userId }, 'submitting query');
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

  userQueries.set(userId, query);

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

  log.info({ trino_query_id: trinoQueryId, user_id: userId }, 'query started');
  return trinoQueryId;
}

export function getQuerySnapshot(userId: string): QuerySnapshot | null {
  const query = userQueries.get(userId);
  if (!query) return null;
  return buildSnapshot(query);
}

export async function cancelQuery(userId: string): Promise<boolean> {
  const query = userQueries.get(userId);
  if (!query || isTerminal(query.state)) return false;

  log.info({ trino_query_id: query.trinoQueryId, user_id: userId }, 'cancelling query');

  try {
    await query.client.cancel(query.trinoQueryId);
  } catch (err) {
    log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel query in Trino');
  }

  terminateQuery(query, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
  return true;
}
