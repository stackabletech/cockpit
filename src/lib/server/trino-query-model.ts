import { trinoActiveQueries } from '$lib/server/metrics.js';
import type { Trino, Iterator as TrinoIterator, QueryResult, QueryStats } from 'trino-client';
import {
  INITIAL_PROGRESS,
  type Column,
  type QueryProgress,
  type QueryState
} from '$lib/types/query.js';

export interface TrinoQuery {
  trinoQueryId: string;
  state: QueryState;
  progress: QueryProgress;
  columns: Column[];
  rows: unknown[][];
  error: string | null;
  sql: string;
  startedAt: number;
  iterator: TrinoIterator<QueryResult>;
  trinoClient: Trino;
  userId: string;
  completedAt: number | null;
}

export function toQueryState(trinoState: string | undefined): QueryState {
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

export function toQueryProgress(stats: QueryStats | undefined): QueryProgress {
  if (!stats) return INITIAL_PROGRESS;
  return {
    progressPercentage: stats.progressPercentage ?? 0,
    processedRows: stats.processedRows ?? 0,
    elapsedTimeMillis: stats.elapsedTimeMillis ?? 0
  };
}

export function terminateQuery(query: TrinoQuery, state: QueryState, { wasActive = true } = {}) {
  query.state = state;
  query.completedAt = Date.now();
  if (wasActive) trinoActiveQueries.dec();
}
