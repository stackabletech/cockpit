import {
  INITIAL_PROGRESS,
  isTerminal,
  type Column,
  type QueryProgress,
  type QuerySnapshot,
  type QueryState,
  type ScriptProgress
} from '$lib/types/query.js';
import type { SqlStatement } from '$lib/editor/split-statements.js';

export { INITIAL_PROGRESS, type QueryState, type QueryProgress } from '$lib/types/query.js';
export type { ScriptProgress } from '$lib/types/query.js';

export interface QueryRunner {
  readonly state: QueryState;
  readonly progress: QueryProgress;
  readonly results: QuerySnapshot[];
  readonly scriptProgress: ScriptProgress | null;
  execute: (sql: string, options?: { catalog?: string; schema?: string }) => Promise<void>;
  executeScript: (
    statements: SqlStatement[],
    options?: { catalog?: string; schema?: string }
  ) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  initialise: (snapshots: QuerySnapshot[]) => void;
  fetchResults: () => Promise<void>;
}

// Plain Map — not SvelteMap — because getOrCreateQueryRunner is called
// inside $derived which forbids state mutation.
// eslint-disable-next-line svelte/prefer-svelte-reactivity
const runners = new Map<string, QueryRunner>();

function createQueryRunner(tabId: string): QueryRunner {
  // Reactive state exposed to the UI for the live progress indicator.
  let state = $state<QueryState>('IDLE');
  let progress = $state<QueryProgress>(INITIAL_PROGRESS);

  // Current query's data — updated by pollStatus, snapshot into results on completion.
  let columns: Column[] = [];
  let rows: unknown[][] = [];
  let error: string | null = null;
  let trinoQueryUrl: string | null = null;
  let executingSql = '';

  // All completed query results. Uses $state.raw to avoid proxying large row arrays.
  let results = $state.raw<QuerySnapshot[]>([]);
  let scriptProgress = $state<ScriptProgress | null>(null);

  let polling = false;
  let pollAbort: AbortController | null = null;
  let scriptAborted = false;
  let resolveCompletion: (() => void) | null = null;

  function settleCompletion() {
    resolveCompletion?.();
    resolveCompletion = null;
  }

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
    executingSql = '';
    results = [];
    scriptProgress = null;
    scriptAborted = false;
    stopPolling();
  }

  function captureResult(): QuerySnapshot {
    return {
      sql: executingSql,
      state,
      progress,
      columns,
      rows,
      error,
      trinoQueryUrl,
      startedAt: Date.now()
    };
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
          settleCompletion();
          return;
        }

        const snapshot: QuerySnapshot | null = await res.json();
        if (!snapshot) {
          stopPolling();
          settleCompletion();
          return;
        }

        applySnapshot(snapshot);

        if (isTerminal(snapshot.state)) {
          stopPolling();
          settleCompletion();
          return;
        }
      } catch (err) {
        if (signal.aborted) {
          settleCompletion();
          return;
        }
        state = 'FAILED';
        error = err instanceof Error ? err.message : 'Unknown error';
        stopPolling();
        settleCompletion();
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs + 50, 500);
    }
  }

  /** Submits one statement and awaits terminal state. Does not update results — execute() and executeScript() do that after calling this. */
  async function _execute(
    sql: string,
    options?: { catalog?: string; schema?: string },
    resetServer = false
  ) {
    stopPolling();
    progress = INITIAL_PROGRESS;
    columns = [];
    rows = [];
    error = null;
    trinoQueryUrl = null;
    executingSql = sql;
    state = 'SUBMITTING';

    const completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    try {
      const res = await fetch('/trino/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql,
          tabId,
          catalog: options?.catalog,
          schema: options?.schema,
          reset: resetServer
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        state = 'FAILED';
        error = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
        settleCompletion();
        return;
      }

      state = 'QUEUED';
      pollStatus();
    } catch (err) {
      state = 'FAILED';
      error = err instanceof Error ? err.message : 'Unknown error';
      settleCompletion();
      return;
    }

    await completionPromise;
  }

  function initialise(snapshots: QuerySnapshot[]) {
    if (snapshots.length === 0) return;

    const last = snapshots[snapshots.length - 1];
    applySnapshot(last);
    executingSql = last.sql;

    if (isTerminal(last.state)) {
      // All snapshots are terminal — restore full results.
      results = snapshots;
    } else {
      // Last query is still running — restore completed results and poll the active one.
      results = snapshots.slice(0, -1);
      pollStatus();
    }
  }

  async function execute(sql: string, options?: { catalog?: string; schema?: string }) {
    if (state !== 'IDLE' && !isTerminal(state)) {
      await cancel();
    }

    reset();
    await _execute(sql, options, true);
    results = [captureResult()];
  }

  async function executeScript(
    statements: SqlStatement[],
    options?: { catalog?: string; schema?: string }
  ) {
    reset();
    scriptAborted = false;
    scriptProgress = {
      totalStatements: statements.length,
      completedStatements: 0,
      currentStatementIndex: 0
    };

    for (let i = 0; i < statements.length; i++) {
      if (scriptAborted) break;

      scriptProgress = { ...scriptProgress!, currentStatementIndex: i };

      // First statement resets server-side results; subsequent ones append.
      await _execute(statements[i].sql, options, i === 0);

      results = [...results, captureResult()];
      scriptProgress = { ...scriptProgress!, completedStatements: i + 1 };

      if (state === 'FAILED' || state === 'CANCELLED') break;
    }
  }

  async function cancel() {
    scriptAborted = true;
    stopPolling();
    state = 'CANCELLED';
    resolveCompletion?.();
    resolveCompletion = null;

    try {
      await fetch(`/trino/query?tabId=${encodeURIComponent(tabId)}`, { method: 'DELETE' });
    } catch {
      // Best-effort cancel.
    }
  }

  async function fetchResults() {
    // Only fetch if we have results but the last one has no rows (deferred loading).
    if (!isTerminal(state)) return;
    if (results.length > 0 && results[results.length - 1].rows.length > 0) return;

    try {
      const res = await fetch(`/trino/query?tabId=${encodeURIComponent(tabId)}&full=true`);
      if (!res.ok) return;
      const snapshots: QuerySnapshot[] = await res.json();
      if (snapshots.length > 0) {
        const last = snapshots[snapshots.length - 1];
        applySnapshot(last);
        executingSql = last.sql;
        results = snapshots;
      }
    } catch {
      // Best-effort fetch.
    }
  }

  return {
    get state() {
      return state;
    },
    get progress() {
      return progress;
    },
    get results() {
      return results;
    },
    get scriptProgress() {
      return scriptProgress;
    },
    execute,
    executeScript,
    cancel,
    reset,
    initialise,
    fetchResults
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
