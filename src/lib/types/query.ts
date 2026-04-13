export const MAX_CLIENT_ROWS = 10_000;

export const INITIAL_PROGRESS: QueryProgress = {
  progressPercentage: 0,
  processedRows: 0,
  elapsedTimeMillis: 0
};

export interface Column {
  name: string;
  type: string;
}

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

/** Whether the query state is terminal (no further transitions expected). */
export function isTerminal(state: QueryState): boolean {
  return state === 'FINISHED' || state === 'FAILED' || state === 'CANCELLED';
}

/** A single query result — used both as the server wire format and client-side result. */
export interface QuerySnapshot {
  trinoQueryUrl: string | null;
  state: QueryState;
  progress: QueryProgress;
  columns: Column[];
  rows: unknown[][];
  error: string | null;
  sql: string;
  startedAt: number;
}

export interface ScriptProgress {
  totalStatements: number;
  completedStatements: number;
  currentStatementIndex: number;
}
