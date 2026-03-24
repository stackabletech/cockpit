import {
  INITIAL_PROGRESS,
  isTerminal,
  type Column,
  type QueryProgress,
  type QuerySnapshot,
  type QueryState
} from '$lib/types/query.js';

export { INITIAL_PROGRESS, type QueryState, type QueryProgress } from '$lib/types/query.js';

let state = $state<QueryState>('IDLE');
let progress = $state<QueryProgress>(INITIAL_PROGRESS);
let columns = $state<Column[]>([]);
let rows = $state.raw<unknown[][]>([]);
let error = $state<string | null>(null);
let trinoQueryUrl = $state<string | null>(null);

let polling = false;
let pollAbort: AbortController | null = null;

function applySnapshot(snapshot: QuerySnapshot) {
  trinoQueryUrl = snapshot.trinoQueryUrl;
  state = snapshot.state;
  progress = snapshot.progress;
  columns = snapshot.columns;
  rows = snapshot.rows;
  error = snapshot.error;
}

function reset() {
  state = 'IDLE';
  progress = INITIAL_PROGRESS;
  columns = [];
  rows = [];
  error = null;
  trinoQueryUrl = null;
  stopPolling();
}

function stopPolling() {
  polling = false;
  if (pollAbort) {
    pollAbort.abort();
    pollAbort = null;
  }
}

async function pollStatus() {
  if (polling) return;
  polling = true;
  pollAbort = new AbortController();
  const signal = pollAbort.signal;

  let backoffMs = 100;

  while (polling && !signal.aborted) {
    try {
      const res = await fetch('/trino/query', { signal });

      if (!res.ok) {
        // Server error — stop polling.
        state = 'FAILED';
        error = `Status check failed (HTTP ${res.status})`;
        stopPolling();
        return;
      }

      const snapshot: QuerySnapshot | null = await res.json();

      if (!snapshot) {
        // Query not found — it may have expired.
        stopPolling();
        return;
      }

      applySnapshot(snapshot);

      if (isTerminal(snapshot.state)) {
        stopPolling();
        return;
      }
    } catch (err) {
      if (signal.aborted) return;
      // Network error — give up immediately.
      state = 'FAILED';
      error = err instanceof Error ? err.message : 'Unknown error';
      stopPolling();
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, backoffMs));
    backoffMs = Math.min(backoffMs + 50, 500);
  }
}

function initialise(snapshot: QuerySnapshot | null) {
  if (!snapshot) return;

  applySnapshot(snapshot);

  if (!isTerminal(snapshot.state)) {
    pollStatus();
  }
}

async function execute(sql: string, options?: { catalog?: string; schema?: string }) {
  // Cancel any in-flight query first.
  if (state !== 'IDLE' && !isTerminal(state)) {
    await cancel();
  }

  reset();
  state = 'SUBMITTING';

  try {
    const res = await fetch('/trino/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, catalog: options?.catalog, schema: options?.schema })
    });

    if (!res.ok) {
      const data = await res.json().catch(() => null);
      state = 'FAILED';
      error =
        typeof data?.error === 'string'
          ? data.error
          : (data?.error?.message ?? `Query submission failed (HTTP ${res.status})`);
      return;
    }

    state = 'QUEUED';

    // Start polling the server for status updates.
    pollStatus();
  } catch (err) {
    state = 'FAILED';
    error = err instanceof Error ? err.message : 'Unknown error';
  }
}

async function cancel() {
  stopPolling();

  try {
    await fetch('/trino/query', { method: 'DELETE' });
  } catch {
    // Best-effort cancel.
  }

  state = 'CANCELLED';
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
  get trinoQueryUrl() {
    return trinoQueryUrl;
  },
  execute,
  cancel,
  reset,
  initialise
};
