import type { TrinoColumn } from '$lib/server/trino.js';
import {
  INITIAL_PROGRESS,
  type QueryProgress,
  type QuerySnapshot,
  type QueryState
} from '$lib/types/query.js';

export { INITIAL_PROGRESS, type QueryState, type QueryProgress } from '$lib/types/query.js';

let state = $state<QueryState>('IDLE');
let progress = $state<QueryProgress>(INITIAL_PROGRESS);
let columns = $state<TrinoColumn[]>([]);
let rows = $state<unknown[][]>([]);
let error = $state<string | null>(null);
let trinoQueryId = $state<string | null>(null);

let polling = false;
let pollAbort: AbortController | null = null;

function isTerminal(s: QueryState): boolean {
  return s === 'FINISHED' || s === 'FAILED' || s === 'CANCELLED' || s === 'IDLE';
}

function applySnapshot(snapshot: QuerySnapshot) {
  trinoQueryId = snapshot.trinoQueryId;
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
  trinoQueryId = null;
  stopPolling();
}

function stopPolling() {
  polling = false;
  if (pollAbort) {
    pollAbort.abort();
    pollAbort = null;
  }
}

async function pollStatus(queryId: string) {
  if (polling) return;
  polling = true;
  pollAbort = new AbortController();
  const signal = pollAbort.signal;

  let backoffMs = 100;

  while (polling && !signal.aborted) {
    try {
      const res = await fetch(`/trino/api/query/status?queryId=${encodeURIComponent(queryId)}`, {
        signal
      });

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
      // Network error — keep trying a few times then give up.
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
    pollStatus(snapshot.trinoQueryId);
  }
}

async function execute(sql: string) {
  // Cancel any in-flight query first.
  if (!isTerminal(state)) {
    await cancel();
  }

  reset();
  state = 'SUBMITTING';

  try {
    const res = await fetch('/trino/api/statement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      state = 'FAILED';
      error =
        typeof data.error === 'string'
          ? data.error
          : (data.error?.message ?? 'Failed to submit query');
      return;
    }

    trinoQueryId = data.trinoQueryId;
    state = 'QUEUED';

    // Start polling the server for status updates.
    pollStatus(data.trinoQueryId);
  } catch (err) {
    state = 'FAILED';
    error = err instanceof Error ? err.message : 'Unknown error';
  }
}

async function cancel() {
  stopPolling();

  try {
    await fetch('/trino/api/cancel', { method: 'POST' });
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
  get trinoQueryId() {
    return trinoQueryId;
  },
  execute,
  cancel,
  reset,
  initialise
};
