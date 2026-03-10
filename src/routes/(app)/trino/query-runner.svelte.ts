export const MAX_CLIENT_ROWS = 10_000;

interface TrinoColumn {
  name: string;
  type: string;
}

interface TrinoStats {
  state: string;
  progressPercentage?: number;
  processedRows?: number;
  processedBytes?: number;
  elapsedTimeMillis?: number;
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

const INITIAL_PROGRESS: QueryProgress = {
  progressPercentage: 0,
  processedRows: 0,
  elapsedTimeMillis: 0
};

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

let state = $state<QueryState>('IDLE');
let progress = $state<QueryProgress>(INITIAL_PROGRESS);
let columns = $state<TrinoColumn[]>([]);
let rows = $state<unknown[][]>([]);
let error = $state<string | null>(null);
let queryId = $state<string | null>(null);
let nextUri = $state<string | null>(null);

let abortController: AbortController | null = null;

function reset() {
  state = 'IDLE';
  progress = INITIAL_PROGRESS;
  columns = [];
  rows = [];
  error = null;
  queryId = null;
  nextUri = null;
  abortController = null;
}

async function execute(sql: string) {
  // Cancel any in-flight query first.
  if (state !== 'IDLE' && state !== 'FINISHED' && state !== 'FAILED' && state !== 'CANCELLED') {
    await cancel();
  }

  reset();
  state = 'SUBMITTING';

  abortController = new AbortController();
  const signal = abortController.signal;

  try {
    const submitRes = await fetch('/trino/api/statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
      signal
    });

    const submitData = await submitRes.json();

    if (!submitRes.ok || submitData.error) {
      state = 'FAILED';
      error =
        typeof submitData.error === 'string'
          ? submitData.error
          : (submitData.error?.message ?? 'Failed to submit query');
      return;
    }

    queryId = submitData.queryId ?? null;

    if (submitData.columns) columns = submitData.columns;
    if (submitData.data) rows = submitData.data;
    if (submitData.stats) {
      state = mapTrinoState(submitData.stats.state);
      progress = extractProgress(submitData.stats);
    }

    if (submitData.error) {
      state = 'FAILED';
      error = submitData.error.message ?? 'Query failed';
      return;
    }

    nextUri = submitData.nextUri ?? null;

    // Poll loop
    let backoffMs = 0;
    while (nextUri) {
      if (signal.aborted) return;

      if (backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      backoffMs = Math.min(backoffMs + 20, 1000);

      if (signal.aborted) return;

      const pollRes = await fetch('/trino/api/next', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryId, nextUri }),
        signal
      });

      const pollData = await pollRes.json();

      if (!pollRes.ok || (typeof pollData.error === 'string' && pollData.error)) {
        state = 'FAILED';
        error = typeof pollData.error === 'string' ? pollData.error : 'Poll failed';
        return;
      }

      if (pollData.columns && columns.length === 0) {
        columns = pollData.columns;
      }

      if (pollData.data) {
        rows = [...rows, ...pollData.data];
      }

      if (pollData.stats) {
        state = mapTrinoState(pollData.stats.state);
        progress = extractProgress(pollData.stats);
      }

      if (pollData.error) {
        state = 'FAILED';
        error = pollData.error.message ?? 'Query failed';
        return;
      }

      // Row limit check
      if (rows.length >= MAX_CLIENT_ROWS) {
        error = `ROW_LIMIT:${MAX_CLIENT_ROWS}`;
        if (pollData.nextUri) {
          // Fire-and-forget cancel
          fetch('/trino/api/cancel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ queryId, nextUri: pollData.nextUri })
          });
        }
        state = 'FINISHED';
        nextUri = null;
        return;
      }

      nextUri = pollData.nextUri ?? null;
    }

    // No more nextUri — query complete.
    if (state !== 'FAILED') {
      state = 'FINISHED';
    }
  } catch (err) {
    if (signal.aborted) return;
    state = 'FAILED';
    error = err instanceof Error ? err.message : 'Unknown error';
  }
}

async function cancel() {
  if (abortController) {
    abortController.abort();
  }

  if (queryId && nextUri) {
    try {
      await fetch('/trino/api/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queryId, nextUri })
      });
    } catch {
      // Best-effort cancel
    }
  }

  state = 'CANCELLED';
  nextUri = null;
  abortController = null;
}

export const queryRunner = {
  get state() {
    return state;
  },
  get progress() {
    return progress;
  },
  get columns() {
    return columns;
  },
  get rows() {
    return rows;
  },
  get error() {
    return error;
  },
  get queryId() {
    return queryId;
  },
  execute,
  cancel,
  reset
};
