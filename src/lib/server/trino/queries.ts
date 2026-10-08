import { env } from '$env/dynamic/private';
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
import { type TrinoClient, type TrinoQueryStats, resolveTrinoPublicUrl } from './client.js';
import { collectResults } from './result-collector.js';

const log = logger.child({ module: 'trino-queries' });

// --- TTL & eviction configuration ---

/** Time (seconds) before completed, unaccessed tab queries are evicted. */
const QUERY_TTL = Number(env.STACKABLE_COCKPIT_QUERY_TTL) || 1800; // 30 min
const SWEEP_INTERVAL_MS = 60_000;

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
  trinoUser: string;
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

/** Tracks when each tab was last accessed (userId → tabId → timestamp). */
const tabLastAccessed = new Map<string, Map<string, number>>();

/** Abort handle of the script currently executing in each tab (userId → tabId → controller). */
const runningScripts = new Map<string, Map<string, AbortController>>();

/** Register a new script run for a tab, superseding any run still registered. */
function beginScriptRun(userId: string, tabId: string): AbortController {
  let userMap = runningScripts.get(userId);
  if (!userMap) {
    userMap = new Map();
    runningScripts.set(userId, userMap);
  }
  userMap.get(tabId)?.abort();
  const run = new AbortController();
  userMap.set(tabId, run);
  return run;
}

/** Unregister a script run, unless a newer run has already replaced it. */
function endScriptRun(userId: string, tabId: string, run: AbortController): void {
  const userMap = runningScripts.get(userId);
  if (userMap?.get(tabId) !== run) return;
  userMap.delete(tabId);
  if (userMap.size === 0) runningScripts.delete(userId);
}

/** Abort the script running in a tab, if any. Returns whether one was running. */
function abortScriptRun(userId: string, tabId: string): boolean {
  const run = runningScripts.get(userId)?.get(tabId);
  if (!run) return false;
  run.abort();
  endScriptRun(userId, tabId, run);
  return true;
}

function touchTab(userId: string, tabId: string): void {
  let userMap = tabLastAccessed.get(userId);
  if (!userMap) {
    userMap = new Map();
    tabLastAccessed.set(userId, userMap);
  }
  userMap.set(tabId, Date.now());
}

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
  trinoPublicUrl: string | null,
  lightweight = false
): QuerySnapshot {
  return {
    trinoQueryUrl: trinoPublicUrl ? `${trinoPublicUrl}/ui/query.html?${query.trinoQueryId}` : null,
    state: query.state,
    progress: query.progress,
    columns: lightweight ? [] : query.columns,
    rows: lightweight ? [] : query.rows,
    error: query.error,
    sql: query.sql,
    startedAt: query.startedAt
  };
}

// --- Public API ---

/** Clear all stored results for a tab and cancel any active query. */
export async function resetTabQueries(userId: string, tabId: string): Promise<void> {
  // Clear before awaiting Trino, so a script started meanwhile keeps its results.
  abortScriptRun(userId, tabId);
  const cancelled = markActiveQueryCancelled(userId, tabId);
  getUserTabMap(userId).set(tabId, []);
  if (cancelled) await cancelInTrino(cancelled);
}

/** Submit a single SQL statement to Trino. The caller decides whether to store the TrinoQuery. */
async function submitStatement(
  client: TrinoClient,
  userId: string,
  tabId: string,
  sql: string,
  options: { user: string; catalog?: string; schema?: string }
): Promise<TrinoQuery> {
  log.info({ user_id: userId, tab_id: tabId }, 'submitting query');
  trinoQueryTotal.inc({ outcome: 'submitted' });
  let submitResult;
  try {
    submitResult = await client.submit(sql, options);
  } catch (err) {
    trinoQueryTotal.inc({ outcome: 'failed' });
    throw err;
  }

  const trinoQueryId = submitResult.id;
  if (!trinoQueryId) {
    trinoQueryTotal.inc({ outcome: 'failed' });
    throw new Error('Trino did not return a query ID');
  }

  const initialState = submitResult.stats ? mapTrinoState(submitResult.stats.state) : 'QUEUED';

  const query: TrinoQuery = {
    trinoQueryId,
    // As in collectResults: don't expose a terminal state before all result pages
    // are drained. startScript terminates the query once that has happened.
    state: isTerminal(initialState) ? 'RUNNING' : initialState,
    progress: toQueryProgress(submitResult.stats),
    columns: submitResult.columns ?? [],
    rows: submitResult.data ?? [],
    error: null,
    sql,
    startedAt: Date.now(),
    nextUri: submitResult.nextUri,
    client,
    userId,
    trinoUser: options.user,
    completedAt: null
  };

  if (submitResult.error || initialState === 'FAILED') {
    query.error = submitResult.error?.message ?? 'Query failed';
    terminateQuery(query, 'FAILED', { decrementGauge: false });
    trinoQueryTotal.inc({ outcome: 'failed' });
  }

  log.info({ trino_query_id: trinoQueryId, user_id: userId, tab_id: tabId }, 'query started');
  return query;
}

function storeQuery(userId: string, tabId: string, query: TrinoQuery): void {
  const tabMap = getUserTabMap(userId);
  const queries = tabMap.get(tabId) ?? [];
  queries.push(query);
  tabMap.set(tabId, queries);
}

/** Best-effort cancellation of a query on the Trino side. */
async function cancelInTrino(query: TrinoQuery): Promise<void> {
  try {
    if (query.nextUri) {
      await query.client.cancelViaUri(query.nextUri, query.trinoUser);
    } else {
      await query.client.cancel(query.trinoQueryId, query.trinoUser);
    }
  } catch (err) {
    log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel query in Trino');
  }
}

/**
 * Submit and sequentially execute an array of SQL statements.
 * Runs in the background (fire-and-forget from the POST handler).
 * Stops on first failure, cancellation, or submit error. A later script in the
 * same tab, or cancelQuery, aborts the run so it submits no further statements.
 */
export async function startScript(
  client: TrinoClient,
  userId: string,
  tabId: string,
  statements: string[],
  options: { user: string; catalog?: string; schema?: string }
): Promise<void> {
  // Take over the tab synchronously, so the most recently started script wins
  // even while an earlier one is still waiting for Trino.
  const run = beginScriptRun(userId, tabId);
  const cancelled = markActiveQueryCancelled(userId, tabId);
  getUserTabMap(userId).set(tabId, []);
  touchTab(userId, tabId);

  log.info(
    { user_id: userId, tab_id: tabId, statement_count: statements.length },
    'starting script execution'
  );

  try {
    if (cancelled) await cancelInTrino(cancelled);
    await runStatements(client, userId, tabId, statements, options, run.signal);
  } finally {
    endScriptRun(userId, tabId, run);
  }
}

async function runStatements(
  client: TrinoClient,
  userId: string,
  tabId: string,
  statements: string[],
  options: { user: string; catalog?: string; schema?: string },
  signal: AbortSignal
): Promise<void> {
  for (const sql of statements) {
    // Cancelled or superseded during an earlier await (e.g. while cancelling the
    // predecessor's query in Trino).
    if (signal.aborted) break;

    let query: TrinoQuery;
    try {
      query = await submitStatement(client, userId, tabId, sql, options);
    } catch (err) {
      log.error({ err, user_id: userId, tab_id: tabId }, 'failed to submit statement in script');
      break;
    }

    if (signal.aborted) {
      // Cancelled or superseded while Trino was accepting the statement: the
      // result belongs to no one, so cancel it instead of storing it.
      log.info(
        { trino_query_id: query.trinoQueryId, user_id: userId, tab_id: tabId },
        'script aborted during submit'
      );
      if (!isTerminal(query.state)) {
        terminateQuery(query, 'CANCELLED', { decrementGauge: false });
        trinoQueryTotal.inc({ outcome: 'cancelled' });
        await cancelInTrino(query);
      }
      break;
    }
    storeQuery(userId, tabId, query);

    if (!isTerminal(query.state) && query.nextUri) {
      trinoActiveQueries.inc();
      try {
        await collectResults(query);
      } catch (err) {
        log.error({ err, trino_query_id: query.trinoQueryId }, 'poll loop crashed');
        if (!isTerminal(query.state)) {
          query.error = 'Internal poll error';
          terminateQuery(query, 'FAILED');
          trinoQueryTotal.inc({ outcome: 'failed' });
        }
      }
    } else if (!isTerminal(query.state)) {
      terminateQuery(query, 'FINISHED', { decrementGauge: false });
      trinoQueryTotal.inc({ outcome: 'completed' });
    }

    if (query.state !== 'FINISHED') break;
  }
}

/** Returns snapshots for all queries in a tab (completed + active). */
export function getQuerySnapshots(
  userId: string,
  tabId: string,
  lightweight = false
): QuerySnapshot[] {
  touchTab(userId, tabId);
  const trinoPublicUrl = resolveTrinoPublicUrl(userId);
  return getTabQueries(userId, tabId).map((q) => buildSnapshot(q, trinoPublicUrl, lightweight));
}

/** Lightweight summaries without rows/columns — used for SSR to keep the payload small. */
export function getAllQuerySummaries(userId: string): Record<string, QuerySnapshot[]> {
  const tabMap = userQueries.get(userId);
  if (!tabMap) return {};
  const trinoPublicUrl = resolveTrinoPublicUrl(userId);
  const result: Record<string, QuerySnapshot[]> = {};
  for (const [tabId, queries] of tabMap) {
    result[tabId] = queries.map((q) => buildSnapshot(q, trinoPublicUrl, true));
  }
  return result;
}

/** Remove the stored query state for a tab (frees memory). */
export function removeTabQuery(userId: string, tabId: string): void {
  const tabMap = userQueries.get(userId);
  if (!tabMap) return;
  tabMap.delete(tabId);
  const accessMap = tabLastAccessed.get(userId);
  accessMap?.delete(tabId);
  if (tabMap.size === 0) {
    userQueries.delete(userId);
    tabLastAccessed.delete(userId);
  }
}

/** Stop the tab's running script and cancel its active query. Returns whether anything was running. */
export async function cancelQuery(userId: string, tabId: string): Promise<boolean> {
  // Abort first so the script submits no further statements, including while
  // it is between statements and has no active query.
  const scriptAborted = abortScriptRun(userId, tabId);
  if (scriptAborted) log.info({ user_id: userId, tab_id: tabId }, 'script aborted');
  const cancelled = markActiveQueryCancelled(userId, tabId);
  if (cancelled) await cancelInTrino(cancelled);
  return scriptAborted || cancelled !== undefined;
}

/**
 * Mark the tab's active query as cancelled and return it, so the caller can
 * cancel it in Trino. The state changes synchronously: concurrent callers
 * never cancel or count the same query twice.
 */
function markActiveQueryCancelled(userId: string, tabId: string): TrinoQuery | undefined {
  const query = getActiveQuery(userId, tabId);
  if (!query) return undefined;

  log.info(
    { trino_query_id: query.trinoQueryId, user_id: userId, tab_id: tabId },
    'cancelling query'
  );
  terminateQuery(query, 'CANCELLED');
  trinoQueryTotal.inc({ outcome: 'cancelled' });
  return query;
}

// --- Periodic eviction ---

/** Evict all queries for tabs where all queries are terminal and the tab hasn't been touched within the TTL. */
function sweepExpiredQueries(): void {
  const now = Date.now();
  const ttlMs = QUERY_TTL * 1000;
  let swept = 0;

  for (const [userId, tabMap] of userQueries) {
    const accessMap = tabLastAccessed.get(userId);

    for (const [tabId, queries] of tabMap) {
      const allTerminal = queries.every((q) => isTerminal(q.state));
      if (!allTerminal) continue;

      const lastAccess = accessMap?.get(tabId) ?? 0;
      if (now - lastAccess >= ttlMs) {
        swept += queries.length;
        tabMap.delete(tabId);
        accessMap?.delete(tabId);
      }
    }

    // Clean up empty user entries.
    if (tabMap.size === 0) {
      userQueries.delete(userId);
      tabLastAccessed.delete(userId);
    }
  }

  if (swept > 0) {
    log.info({ swept, remaining_users: userQueries.size }, 'swept expired queries');
  }
}

const sweepTimer = setInterval(sweepExpiredQueries, SWEEP_INTERVAL_MS);
sweepTimer.unref();

log.info(
  {
    ttl_s: QUERY_TTL,
    sweep_interval_ms: SWEEP_INTERVAL_MS
  },
  'query eviction configured'
);
