import {
  INITIAL_PROGRESS,
  isTerminal,
  type Column,
  type QueryProgress,
  type QuerySnapshot,
  type QueryState
} from '$lib/types/query.js';

export { INITIAL_PROGRESS, type QueryState, type QueryProgress } from '$lib/types/query.js';

export interface QueryRunner {
  readonly state: QueryState;
  readonly progress: QueryProgress;
  readonly columns: Column[];
  readonly rows: unknown[][];
  readonly error: string | null;
  readonly trinoQueryUrl: string | null;
  execute: (sql: string, options?: { catalog?: string; schema?: string }) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  initialise: (snapshot: QuerySnapshot | null) => void;
}

// Plain Map — not SvelteMap — because getOrCreateQueryRunner is called
// inside $derived which forbids state mutation.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const runners = new Map<string, QueryRunner>();

function createQueryRunner(tabId: string): QueryRunner {
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
        const res = await fetch(`/trino/query?tabId=${encodeURIComponent(tabId)}`, { signal });

        if (!res.ok) {
          state = 'FAILED';
          error = `Status check failed (HTTP ${res.status})`;
          stopPolling();
          return;
        }

        const snapshot: QuerySnapshot | null = await res.json();

        if (!snapshot) {
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
    if (state !== 'IDLE' && !isTerminal(state)) {
      await cancel();
    }

    reset();
    state = 'SUBMITTING';

    try {
      const res = await fetch('/trino/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, tabId, catalog: options?.catalog, schema: options?.schema })
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
      pollStatus();
    } catch (err) {
      state = 'FAILED';
      error = err instanceof Error ? err.message : 'Unknown error';
    }
  }

  async function cancel() {
    stopPolling();
    state = 'CANCELLED';

    try {
      await fetch(`/trino/query?tabId=${encodeURIComponent(tabId)}`, { method: 'DELETE' });
    } catch {
      // Best-effort cancel.
    }
  }

  return {
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
}

export function getOrCreateQueryRunner(tabId: string): QueryRunner {
  let runner = runners.get(tabId);
  if (!runner) {
    runner = createQueryRunner(tabId);
    runners.set(tabId, runner);
  }
  return runner;
}

export function destroyQueryRunner(tabId: string): void {
  const runner = runners.get(tabId);
  if (runner) {
    runner.cancel();
    runners.delete(tabId);
  }
}
