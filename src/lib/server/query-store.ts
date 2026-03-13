import { logger } from '$lib/server/logging';
import { trinoActiveQueries, trinoQueryTotal } from '$lib/server/metrics.js';
import {
  type ConnectionConfig,
  type TrinoColumn,
  type TrinoResponse,
  type TrinoStats,
  trinoFetch,
  validateTargetUrl
} from '$lib/server/trino.js';
import {
  INITIAL_PROGRESS,
  MAX_CLIENT_ROWS,
  type QueryProgress,
  type QuerySnapshot,
  type QueryState
} from '$lib/types/query.js';

const log = logger.child({ module: 'query-store' });

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const COMPLETED_TTL_MS = 30 * 60 * 1000;

interface ActiveQuery {
  trinoQueryId: string;
  state: QueryState;
  progress: QueryProgress;
  columns: TrinoColumn[];
  rows: unknown[][];
  error: string | null;
  sql: string;
  startedAt: number;
  nextUri: string | null;
  connection: ConnectionConfig;
  userId: string;
  completedAt: number | null;
}

/** All queries keyed by Trino query ID. */
const queries = new Map<string, ActiveQuery>();

/** Mapping from userId to their set of Trino query IDs. */
const userQueries = new Map<string, Set<string>>();

function isTerminal(state: QueryState): boolean {
  return state === 'FINISHED' || state === 'FAILED' || state === 'CANCELLED';
}

function mapTrinoState(trinoState: string | undefined): QueryState {
  switch (trinoState) {
    case 'QUEUED':
      return 'QUEUED';
    case 'PLANNING':
      return 'PLANNING';
    case 'STARTING':
    case 'RUNNING':
      return 'RUNNING';
    case 'FINISHING':
      return 'FINISHING';
    case 'FINISHED':
      return 'FINISHED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'RUNNING';
  }
}

function extractProgress(stats: TrinoStats | undefined): QueryProgress {
  if (!stats) return INITIAL_PROGRESS;
  return {
    progressPercentage: stats.progressPercentage ?? 0,
    processedRows: stats.processedRows ?? 0,
    elapsedTimeMillis: stats.elapsedTimeMillis ?? 0
  };
}

export function getUserId(locals: App.Locals): string {
  return locals.user?.id ?? 'anonymous';
}

function toSnapshot(q: ActiveQuery): QuerySnapshot {
  return {
    trinoQueryId: q.trinoQueryId,
    state: q.state,
    progress: q.progress,
    columns: q.columns,
    rows: q.rows,
    error: q.error,
    sql: q.sql,
    startedAt: q.startedAt
  };
}

function markTerminal(q: ActiveQuery, state: QueryState) {
  q.state = state;
  q.completedAt = Date.now();
  q.nextUri = null;
  trinoActiveQueries.dec();
}

/**
 * Cancel and clean up all active queries for a user.
 * Used to enforce single-query limit before starting a new one.
 */
async function cancelUserActiveQueries(userId: string): Promise<void> {
  const ids = userQueries.get(userId);
  if (!ids) return;

  for (const qid of ids) {
    const q = queries.get(qid);
    if (q && !isTerminal(q.state)) {
      log.info({ trino_query_id: qid, user_id: userId }, 'cancelling previous query');
      if (q.nextUri && validateTargetUrl(q.nextUri, q.connection.connectionUrl)) {
        try {
          await trinoFetch(
            q.nextUri,
            q.connection.auth,
            { method: 'DELETE' },
            q.connection.impersonateUser
          );
        } catch (err) {
          log.warn({ err, trino_query_id: qid }, 'failed to cancel previous query in Trino');
        }
      }
      markTerminal(q, 'CANCELLED');
      trinoQueryTotal.inc({ outcome: 'cancelled' });
    }
  }
}

async function pollLoop(trinoQueryId: string): Promise<void> {
  const q = queries.get(trinoQueryId);
  if (!q) return;

  let backoffMs = 0;

  while (q.nextUri) {
    if (backoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    backoffMs = Math.min(backoffMs + 20, 1000);

    // Re-check — query may have been cancelled externally.
    if (isTerminal(q.state) || !q.nextUri) return;

    if (!validateTargetUrl(q.nextUri, q.connection.connectionUrl)) {
      log.warn(
        { trino_query_id: trinoQueryId, next_uri: q.nextUri },
        'SSRF: nextUri origin mismatch'
      );
      q.error = 'Target URL origin does not match connection';
      markTerminal(q, 'FAILED');
      trinoQueryTotal.inc({ outcome: 'failed' });
      return;
    }

    let response: TrinoResponse;
    try {
      response = await trinoFetch(
        q.nextUri,
        q.connection.auth,
        undefined,
        q.connection.impersonateUser
      );
    } catch (err) {
      // Guard: query may have been cancelled while fetch was in flight.
      if (isTerminal(q.state)) return;

      log.error({ err, trino_query_id: trinoQueryId }, 'poll failed');
      q.error = err instanceof Error ? err.message : 'Poll failed';
      markTerminal(q, 'FAILED');
      trinoQueryTotal.inc({ outcome: 'failed' });
      return;
    }

    // Guard: query may have been cancelled while fetch was in flight.
    if (isTerminal(q.state)) return;

    log.debug({ trino_query_id: trinoQueryId, state: response.stats?.state }, 'polled next');

    if (response.columns && q.columns.length === 0) {
      q.columns = response.columns;
    }

    if (response.data) {
      q.rows.push(...response.data);
    }

    if (response.stats) {
      q.state = mapTrinoState(response.stats.state);
      q.progress = extractProgress(response.stats);
    }

    if (response.error) {
      q.error = response.error.message ?? 'Query failed';
      markTerminal(q, 'FAILED');
      trinoQueryTotal.inc({ outcome: 'failed' });
      return;
    }

    // Row limit check.
    if (q.rows.length >= MAX_CLIENT_ROWS) {
      q.error = `ROW_LIMIT:${MAX_CLIENT_ROWS}`;
      if (response.nextUri && validateTargetUrl(response.nextUri, q.connection.connectionUrl)) {
        try {
          await trinoFetch(
            response.nextUri,
            q.connection.auth,
            { method: 'DELETE' },
            q.connection.impersonateUser
          );
        } catch {
          // Best-effort cancel.
        }
      }
      markTerminal(q, 'FINISHED');
      return;
    }

    q.nextUri = response.nextUri ?? null;
  }

  // No more nextUri — query complete.
  if (!isTerminal(q.state)) {
    markTerminal(q, 'FINISHED');
    trinoQueryTotal.inc({ outcome: 'completed' });
    log.info({ trino_query_id: trinoQueryId }, 'query completed');
  }
}

export async function startQuery(
  userId: string,
  sql: string,
  connection: ConnectionConfig
): Promise<string> {
  // Cancel existing active queries for this user (single-query limit).
  await cancelUserActiveQueries(userId);

  // Trino's REST API rejects SQL ending with a semicolon.
  const cleanSql = sql.replace(/;\s*$/, '').trim();

  log.info({ user_id: userId, trino_url: connection.connectionUrl }, 'submitting query');
  trinoQueryTotal.inc({ outcome: 'submitted' });

  const response = await trinoFetch(
    `${connection.connectionUrl}/v1/statement`,
    connection.auth,
    {
      method: 'POST',
      body: cleanSql,
      headers: { 'Content-Type': 'text/plain' }
    },
    connection.impersonateUser
  );

  const trinoQueryId = response.id;
  if (!trinoQueryId) {
    throw new Error('Trino did not return a query ID');
  }

  const q: ActiveQuery = {
    trinoQueryId,
    state: response.stats ? mapTrinoState(response.stats.state) : 'QUEUED',
    progress: extractProgress(response.stats),
    columns: response.columns ?? [],
    rows: response.data ?? [],
    error: null,
    sql: cleanSql,
    startedAt: Date.now(),
    nextUri: response.nextUri ?? null,
    connection,
    userId,
    completedAt: null
  };

  if (response.error) {
    q.error = response.error.message ?? 'Query failed';
    q.state = 'FAILED';
    q.completedAt = Date.now();
    trinoQueryTotal.inc({ outcome: 'failed' });
  }

  queries.set(trinoQueryId, q);

  if (!userQueries.has(userId)) {
    userQueries.set(userId, new Set());
  }
  userQueries.get(userId)!.add(trinoQueryId);

  if (!isTerminal(q.state) && q.nextUri) {
    trinoActiveQueries.inc();
    // Fire-and-forget — the poll loop runs independently.
    pollLoop(trinoQueryId).catch((err) => {
      log.error({ err, trino_query_id: trinoQueryId }, 'poll loop crashed');
      const query = queries.get(trinoQueryId);
      if (query && !isTerminal(query.state)) {
        query.error = 'Internal poll error';
        markTerminal(query, 'FAILED');
        trinoQueryTotal.inc({ outcome: 'failed' });
      }
    });
  } else if (!isTerminal(q.state)) {
    // No nextUri but not terminal — mark finished.
    q.state = 'FINISHED';
    q.completedAt = Date.now();
  }

  log.info({ trino_query_id: trinoQueryId, user_id: userId }, 'query started');
  return trinoQueryId;
}

export function getQuerySnapshot(userId: string, trinoQueryId?: string): QuerySnapshot | null {
  if (trinoQueryId) {
    const q = queries.get(trinoQueryId);
    if (!q || q.userId !== userId) return null;
    return toSnapshot(q);
  }

  // Return most recent active query for user, or most recent completed.
  const ids = userQueries.get(userId);
  if (!ids || ids.size === 0) return null;

  let best: ActiveQuery | null = null;
  for (const qid of ids) {
    const q = queries.get(qid);
    if (!q) continue;
    // Prefer active queries.
    if (!best) {
      best = q;
    } else if (!isTerminal(q.state) && isTerminal(best.state)) {
      best = q;
    } else if (isTerminal(q.state) === isTerminal(best.state) && q.startedAt > best.startedAt) {
      best = q;
    }
  }

  return best ? toSnapshot(best) : null;
}

export async function cancelQuery(userId: string, trinoQueryId?: string): Promise<boolean> {
  let q: ActiveQuery | undefined;

  if (trinoQueryId) {
    q = queries.get(trinoQueryId);
    if (!q || q.userId !== userId) return false;
  } else {
    // Cancel the most recent active query for the user.
    const ids = userQueries.get(userId);
    if (!ids) return false;
    for (const qid of ids) {
      const candidate = queries.get(qid);
      if (candidate && !isTerminal(candidate.state)) {
        q = candidate;
        break;
      }
    }
  }

  if (!q || isTerminal(q.state)) return false;

  log.info({ trino_query_id: q.trinoQueryId, user_id: userId }, 'cancelling query');

  if (q.nextUri && validateTargetUrl(q.nextUri, q.connection.connectionUrl)) {
    try {
      await trinoFetch(
        q.nextUri,
        q.connection.auth,
        { method: 'DELETE' },
        q.connection.impersonateUser
      );
    } catch (err) {
      log.warn({ err, trino_query_id: q.trinoQueryId }, 'failed to cancel query in Trino');
    }
  }

  markTerminal(q, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
  return true;
}

// Periodic cleanup of completed queries older than TTL.
setInterval(() => {
  const now = Date.now();
  for (const [qid, q] of queries) {
    if (q.completedAt && now - q.completedAt > COMPLETED_TTL_MS) {
      queries.delete(qid);
      const ids = userQueries.get(q.userId);
      if (ids) {
        ids.delete(qid);
        if (ids.size === 0) userQueries.delete(q.userId);
      }
      log.debug({ trino_query_id: qid }, 'cleaned up expired query');
    }
  }
}, CLEANUP_INTERVAL_MS);
