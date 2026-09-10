import {
  INITIAL_PROGRESS,
  isTerminal,
  type QueryProgress,
  type QuerySnapshot,
  type QueryState,
  type ScriptProgress
} from '$lib/types/query.js';
import type { SqlStatement } from '$lib/editor/split-statements.js';
import { clearCompletionCache } from '$lib/editor/completion/completion-metadata.js';
import * as m from '$lib/paraglide/messages.js';

export { INITIAL_PROGRESS, type QueryState, type QueryProgress } from '$lib/types/query.js';
export type { ScriptProgress } from '$lib/types/query.js';

export interface QueryRunner {
  readonly state: QueryState;
  readonly progress: QueryProgress;
  readonly results: QuerySnapshot[];
  readonly scriptProgress: ScriptProgress | null;
  readonly currentTrinoQueryUrl: string | null;
  readonly error: string | null;
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

  // All query results. Uses $state.raw to avoid proxying large row arrays.
  let results = $state.raw<QuerySnapshot[]>([]);
  let scriptProgress = $state<ScriptProgress | null>(null);
  let currentTrinoQueryUrl = $state<string | null>(null);
  let error = $state<string | null>(null);

  let totalStatements = 0;
  let polling = false;
  let pollAbort: AbortController | null = null;

  function applySnapshot(snapshot: QuerySnapshot) {
    state = snapshot.state;
    progress = snapshot.progress;
  }

  function reset() {
    state = 'IDLE';
    progress = INITIAL_PROGRESS;
    results = [];
    scriptProgress = null;
    currentTrinoQueryUrl = null;
    error = null;
    totalStatements = 0;
    stopPolling();
  }

  function stopPolling() {
    polling = false;
    if (pollAbort) {
      pollAbort.abort();
      pollAbort = null;
    }
  }

  function updateProgress(snapshots: QuerySnapshot[]) {
    if (snapshots.length === 0) return;

    const last = snapshots[snapshots.length - 1];
    applySnapshot(last);
    currentTrinoQueryUrl = last.trinoQueryUrl;

    if (totalStatements > 1) {
      const completedCount = snapshots.filter((s) => isTerminal(s.state)).length;
      scriptProgress = {
        totalStatements,
        completedStatements: completedCount,
        currentStatementIndex: Math.min(
          completedCount,
          completedCount === snapshots.length ? snapshots.length - 1 : totalStatements - 1
        )
      };
    }
  }

  function updateFromSnapshots(snapshots: QuerySnapshot[]) {
    results = snapshots;
    updateProgress(snapshots);
  }

  async function pollStatus() {
    if (polling) return;
    polling = true;
    pollAbort = new AbortController();
    const signal = pollAbort.signal;

    let backoffMs = 100;

    while (polling && !signal.aborted) {
      try {
        const res = await fetch(`/api/trino/query?tabId=${encodeURIComponent(tabId)}`, { signal });

        if (!res.ok) {
          error = m.trino_query_connection_lost();
          state = 'FAILED';
          stopPolling();
          return;
        }

        const snapshots: QuerySnapshot[] = await res.json();

        // When a statement finishes, the lightweight response has empty rows/columns.
        // Fetch full data for any newly completed statement.
        const hasNewlyCompleted = snapshots.some(
          (s, i) =>
            isTerminal(s.state) &&
            s.rows.length === 0 &&
            s.columns.length === 0 &&
            // eslint-disable-next-line security/detect-object-injection
            (!results[i] || !isTerminal(results[i].state) || results[i].rows.length === 0)
        );
        if (hasNewlyCompleted) {
          const fullRes = await fetch(
            `/api/trino/query?tabId=${encodeURIComponent(tabId)}&lightweight=false`,
            { signal }
          );
          if (fullRes.ok) {
            updateFromSnapshots(await fullRes.json());
          }
        } else {
          // Lightweight responses omit rows/columns for completed statements.
          // Only update state and progress — keep existing results intact.
          updateProgress(snapshots);
        }

        const allTerminal = snapshots.length > 0 && snapshots.every((s) => isTerminal(s.state));
        if (allTerminal) {
          // A DDL statement (CREATE/DROP/ALTER) may have changed the catalog;
          // invalidate the completion cache so the next suggestion fetches fresh.
          clearCompletionCache();
          stopPolling();
          return;
        }
      } catch (err) {
        if (signal.aborted) return;
        console.error('Query poll failed', err);
        error = m.trino_query_connection_lost();
        state = 'FAILED';
        stopPolling();
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      backoffMs = Math.min(backoffMs + 50, 500);
    }
  }

  async function submitStatements(
    statements: string[],
    options?: { catalog?: string; schema?: string }
  ) {
    if (state !== 'IDLE' && !isTerminal(state)) {
      await cancel();
    }

    reset();
    totalStatements = statements.length;
    if (statements.length > 1) {
      scriptProgress = {
        totalStatements: statements.length,
        completedStatements: 0,
        currentStatementIndex: 0
      };
    }
    state = 'SUBMITTING';

    try {
      const res = await fetch('/api/trino/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          statements,
          tabId,
          catalog: options?.catalog,
          schema: options?.schema
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error('Query submit failed', body?.error ?? `HTTP ${res.status}`);
        error = body?.error ?? m.trino_query_connection_lost();
        state = 'FAILED';
        return;
      }

      state = 'QUEUED';
      pollStatus();
    } catch {
      error = m.trino_query_connection_lost();
      state = 'FAILED';
    }
  }

  function initialise(snapshots: QuerySnapshot[]) {
    if (snapshots.length === 0) return;

    const last = snapshots[snapshots.length - 1];
    applySnapshot(last);

    if (isTerminal(last.state)) {
      results = snapshots;
    } else {
      // Last query is still running — restore completed results and poll the active one.
      results = snapshots.slice(0, -1);
      pollStatus();
    }
  }

  async function executeScript(
    statements: SqlStatement[],
    options?: { catalog?: string; schema?: string }
  ) {
    await submitStatements(
      statements.map((s) => s.sql),
      options
    );
  }

  async function cancel() {
    stopPolling();
    state = 'CANCELLED';

    try {
      await fetch(`/api/trino/query?tabId=${encodeURIComponent(tabId)}`, { method: 'DELETE' });
    } catch {
      // Best-effort cancel.
    }
  }

  async function fetchResults() {
    // Only fetch if we have results but the last one has no rows (deferred loading).
    if (!isTerminal(state)) return;
    if (results.length > 0 && results[results.length - 1].rows.length > 0) return;

    try {
      const res = await fetch(
        `/api/trino/query?tabId=${encodeURIComponent(tabId)}&lightweight=false`
      );
      if (!res.ok) return;
      const snapshots: QuerySnapshot[] = await res.json();
      if (snapshots.length > 0) {
        updateFromSnapshots(snapshots);
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
    get currentTrinoQueryUrl() {
      return currentTrinoQueryUrl;
    },
    get error() {
      return error;
    },
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
