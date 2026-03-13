import type { TrinoColumn } from '$lib/server/trino.js';

export const MAX_CLIENT_ROWS = 10_000;

export const INITIAL_PROGRESS: QueryProgress = {
  progressPercentage: 0,
  processedRows: 0,
  elapsedTimeMillis: 0
};

export type QueryState =
  | 'IDLE'
  | 'SUBMITTING'
  | 'QUEUED'
  | 'PLANNING'
  | 'RUNNING'
  | 'FINISHING'
  | 'FINISHED'
  | 'FAILED'
  | 'CANCELLED';

export interface QueryProgress {
  progressPercentage: number;
  processedRows: number;
  elapsedTimeMillis: number;
}

export interface QuerySnapshot {
  trinoQueryId: string;
  state: QueryState;
  progress: QueryProgress;
  columns: TrinoColumn[];
  rows: unknown[][];
  error: string | null;
  sql: string;
  startedAt: number;
}
