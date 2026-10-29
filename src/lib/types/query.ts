export const MAX_CLIENT_ROWS = 10_000;

export const INITIAL_PROGRESS: QueryProgress = {
  progressPercentage: 0,
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
  elapsedTimeMillis: number;
}

/**
 * Why a query failed, safe to show to the user. Only errors in the user's own
 * query carry Trino's message; server-side errors could expose internals.
 */
export type QueryError =
  /** Error in the query itself (syntax, missing table, access denied, resource limit). */
  | { kind: 'query'; message: string }
  /** Trino or a connector failed; only Trino's error name is passed on. */
  | { kind: 'server'; name: string | null }
  /** Trino could not be reached or sent an invalid response. */
  | { kind: 'unavailable' }
  /** Failed without details. */
  | { kind: 'unknown' };

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
  /** Rows fetched so far. Populated even in lightweight snapshots, where `rows` is empty. */
  rowCount: number;
  error: QueryError | null;
  /** Fetching stopped and the query was cancelled because more than MAX_CLIENT_ROWS rows arrived. */
  rowLimitReached: boolean;
  sql: string;
  startedAt: number;
}

export interface ScriptProgress {
  totalStatements: number;
  completedStatements: number;
  currentStatementIndex: number;
}
