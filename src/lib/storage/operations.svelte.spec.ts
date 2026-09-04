vi.mock('$app/environment', () => ({ browser: true }));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OperationsState } from './operations.svelte.js';
import type { StorageApi } from './api.js';
import type { StorageOperation } from './types.js';

const OPERATIONS_HISTORY_KEY = 'storage_operations_history';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeMockApi(): StorageApi {
  return {
    pollJob: vi.fn().mockResolvedValue({ status: 'done' }),
    cancelJob: vi.fn(),
    list: vi.fn(),
    copy: vi.fn(),
    move: vi.fn(),
    rename: vi.fn(),
    delete: vi.fn(),
    create: vi.fn(),
    archiveExtract: vi.fn(),
    archiveListing: vi.fn(),
    checkObjectExists: vi.fn(),
    preview: vi.fn(),
    saveText: vi.fn(),
    details: vi.fn(),
    directoryMetadata: vi.fn(),
    directorySize: vi.fn(),
    bucketDetails: vi.fn(),
    checkBucket: vi.fn(),
    updateConnections: vi.fn()
  } as unknown as StorageApi;
}

function makeOpts(
  overrides?: Partial<import('./operations.svelte.js').OperationsStateOpts>
): import('./operations.svelte.js').OperationsStateOpts {
  return {
    getBucket: () => 'test-bucket',
    getPrefix: () => '',
    ...overrides
  };
}

function makeOp(overrides?: Partial<StorageOperation>): StorageOperation {
  return {
    id: 'op-1',
    label: 'Copy: file.txt',
    status: 'running',
    type: 'paste',
    itemCount: 1,
    completedCount: 0,
    startedAt: Date.now(),
    destPath: 'test-bucket/test/',
    sourceNames: ['file.txt'],
    totalBytes: 100,
    completedBytes: 0,
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

// ──────────────────────────────────────────────────────────────────────────────
// Group 1: localStorage persistence
// ──────────────────────────────────────────────────────────────────────────────

describe('localStorage persistence', () => {
  it('constructor reads running ops from localStorage and marks them interrupted', () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([makeOp({ id: 'op-1', status: 'running' })])
    );

    const state = new OperationsState(makeMockApi(), makeOpts());

    expect(state.operations).toHaveLength(1);
    expect(state.operations[0].id).toBe('op-1');
    expect(state.operations[0].status).toBe('interrupted');
  });

  it('constructor handles malformed JSON gracefully', () => {
    localStorage.setItem(OPERATIONS_HISTORY_KEY, 'not-valid-json');

    const state = new OperationsState(makeMockApi(), makeOpts());

    expect(state.operations).toEqual([]);
  });

  it('constructor handles non-array JSON gracefully', () => {
    localStorage.setItem(OPERATIONS_HISTORY_KEY, '{"key": "value"}');

    const state = new OperationsState(makeMockApi(), makeOpts());

    expect(state.operations).toEqual([]);
  });

  it('constructor handles missing localStorage key gracefully', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());

    expect(state.operations).toEqual([]);
  });

  it('startOp persists a running operation to localStorage', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());

    state.startOp('op-1', 'Copy: file.txt', 'paste', 1);

    const stored = JSON.parse(localStorage.getItem(OPERATIONS_HISTORY_KEY)!) as StorageOperation[];
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('op-1');
    expect(stored[0].status).toBe('running');
  });

  it('finishOp updates the operation status in localStorage', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Copy: file.txt', 'paste', 1);

    state.finishOp('op-1', 'done');

    const stored = JSON.parse(localStorage.getItem(OPERATIONS_HISTORY_KEY)!) as StorageOperation[];
    expect(stored[0].status).toBe('done');
    expect(stored[0].completedAt).toBeGreaterThan(0);
  });

  it('updateOpJobIds persists fileJobIds to localStorage', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Copy: file.txt', 'paste', 3);

    state.updateOpJobIds('op-1', ['job-1', 'job-2']);

    const stored = JSON.parse(localStorage.getItem(OPERATIONS_HISTORY_KEY)!) as StorageOperation[];
    expect(stored[0].fileJobIds).toEqual(['job-1', 'job-2']);
  });

  it('clearOperationHistory removes non-running ops from localStorage but keeps running ones', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Op 1', 'paste', 1);
    state.startOp('op-2', 'Op 2', 'move', 1);
    state.finishOp('op-1', 'done');

    state.clearOperationHistory();

    const stored = JSON.parse(localStorage.getItem(OPERATIONS_HISTORY_KEY)!) as StorageOperation[];
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('op-2');
    expect(stored[0].status).toBe('running');
  });

  it('keeps completed ops from previous pages in localStorage when saving new ones', () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([makeOp({ id: 'legacy', status: 'done' })])
    );
    const state = new OperationsState(makeMockApi(), makeOpts());

    state.startOp('op-1', 'New op', 'paste', 1);

    const stored = JSON.parse(localStorage.getItem(OPERATIONS_HISTORY_KEY)!) as StorageOperation[];
    expect(stored.some((o) => o.id === 'legacy')).toBe(true);
    expect(stored.some((o) => o.id === 'op-1')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group 2: OperationsState lifecycle
// ──────────────────────────────────────────────────────────────────────────────

describe('OperationsState lifecycle', () => {
  it('startOp creates operation with correct label, type, itemCount, status=running, totalBytes', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());

    state.startOp('op-1', 'Copy: file.txt', 'paste', 5, undefined, undefined, undefined, 1024);

    const op = state.operations[0];
    expect(op.id).toBe('op-1');
    expect(op.label).toBe('Copy: file.txt');
    expect(op.type).toBe('paste');
    expect(op.itemCount).toBe(5);
    expect(op.status).toBe('running');
    expect(op.totalBytes).toBe(1024);
    expect(op.completedCount).toBe(0);
    expect(op.completedBytes).toBe(0);
    expect(op.startedAt).toBeGreaterThan(0);
  });

  it('startOp stores abortController when provided', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    const controller = new AbortController();

    state.startOp('op-1', 'Test', 'paste', 1, controller);

    expect(controller.signal.aborted).toBe(false);
    state.cancelOp('op-1');
    expect(controller.signal.aborted).toBe(true);
  });

  it('updateOpProgress updates completedCount, completedBytes, currentFileName', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Copy: file.txt', 'paste', 3, undefined, undefined, undefined, 500);

    state.updateOpProgress('op-1', 2, 300, 'file1.txt');

    const op = state.operations[0];
    expect(op.completedCount).toBe(2);
    expect(op.completedBytes).toBe(300);
    expect(op.currentFileName).toBe('file1.txt');
  });

  it('updateOpProgress does NOT update operations with status cancelled', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 3, undefined, undefined, undefined, 500);
    state.finishOp('op-1', 'cancelled');

    state.updateOpProgress('op-1', 2, 200);

    const op = state.operations[0];
    expect(op.status).toBe('cancelled');
    expect(op.completedCount).toBe(0);
  });

  it('updateOpJobIds sets fileJobIds on the operation', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'move', 2);

    state.updateOpJobIds('op-1', ['job-a', 'job-b']);

    expect(state.operations[0].fileJobIds).toEqual(['job-a', 'job-b']);
  });

  it('updateOpTotalBytes refines only the target operation size', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Download', 'download', 4, undefined, undefined, undefined, 100);
    state.startOp('op-2', 'Other', 'download', 1, undefined, undefined, undefined, 200);

    state.updateOpTotalBytes('op-1', 900);

    expect(state.operations[0].totalBytes).toBe(900);
    expect(state.operations[1].totalBytes).toBe(200);
  });

  it('finishOp with done sets status=done and completedAt', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1);

    state.finishOp('op-1', 'done');

    const op = state.operations[0];
    expect(op.status).toBe('done');
    expect(op.completedAt).toBeGreaterThan(0);
  });

  it('finishOp with error sets status=error and errorMessage', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1);

    state.finishOp('op-1', 'error', 'Something went wrong');

    const op = state.operations[0];
    expect(op.status).toBe('error');
    expect(op.errorMessage).toBe('Something went wrong');
    expect(op.completedAt).toBeGreaterThan(0);
  });

  it('finishOp with cancelled sets status=cancelled', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1);

    state.finishOp('op-1', 'cancelled');

    expect(state.operations[0].status).toBe('cancelled');
  });

  it('finishOp does NOT override an already-cancelled operation', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1);
    state.finishOp('op-1', 'cancelled');

    state.finishOp('op-1', 'done');

    expect(state.operations[0].status).toBe('cancelled');
  });

  it('finishOp does not throw when abort controller was never stored', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1); // No abortController

    // Should not throw even though there's no controller to delete
    expect(() => state.finishOp('op-1', 'done')).not.toThrow();
    expect(state.operations[0].status).toBe('done');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group 3: Reactive derived (hasRunningOps)
// ──────────────────────────────────────────────────────────────────────────────

describe('hasRunningOps', () => {
  it('is true when at least one operation has status=running', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1);

    expect(state.hasRunningOps).toBe(true);
  });

  it('is false when all operations are done/error/cancelled', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1);
    state.finishOp('op-1', 'done');

    expect(state.hasRunningOps).toBe(false);
  });

  it('transitions correctly when a running operation finishes', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1);

    expect(state.hasRunningOps).toBe(true);

    state.finishOp('op-1', 'done');

    expect(state.hasRunningOps).toBe(false);
  });

  it('is false when all persisted operations have status interrupted', () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({ id: 'op-1', status: 'running' }),
        makeOp({ id: 'op-2', status: 'running' })
      ])
    );

    const state = new OperationsState(makeMockApi(), makeOpts());

    // Constructor marks them as 'interrupted', not 'running'
    expect(state.hasRunningOps).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group 4: cancelOp + clearOperationHistory
// ──────────────────────────────────────────────────────────────────────────────

describe('cancelOp', () => {
  it('aborts the abort controller and sets status=cancelled', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    const controller = new AbortController();
    state.startOp('op-1', 'Test', 'paste', 1, controller);

    state.cancelOp('op-1');

    expect(controller.signal.aborted).toBe(true);
    expect(state.operations[0].status).toBe('cancelled');
  });

  it('stops polling timers', async () => {
    vi.useFakeTimers();
    const api = makeMockApi();
    api.pollJob = vi.fn().mockResolvedValue({
      status: 'running',
      progress: { completedBytes: 50 }
    });

    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([makeOp({ id: 'op-1', status: 'running', fileJobIds: ['job-1'] })])
    );

    const state = new OperationsState(api, makeOpts());

    // Flush microtasks so the first poll completes (returns 'running')
    await Promise.resolve();
    await Promise.resolve();

    // The op should now be 'running' and a timer is scheduled
    expect(state.operations[0].status).toBe('running');
    expect(api.pollJob).toHaveBeenCalledWith('job-1');

    // Cancel — should clear the pending timer
    state.cancelOp('op-1');

    // Reset mock call tracking
    vi.clearAllMocks();

    // Advance well past the 2000ms interval
    vi.advanceTimersByTime(3000);

    expect(api.pollJob).not.toHaveBeenCalled();
    expect(state.operations[0].status).toBe('cancelled');

    vi.useRealTimers();
  });

  it('works when no abort controller exists', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Test', 'paste', 1); // No abortController

    expect(() => state.cancelOp('op-1')).not.toThrow();
    expect(state.operations[0].status).toBe('cancelled');
  });

  it('works for unknown op id', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());

    expect(() => state.cancelOp('nonexistent')).not.toThrow();
  });

  it('cancels every active browser download job', () => {
    const api = makeMockApi();
    const state = new OperationsState(api, makeOpts());
    state.startOp('op-1', 'Download', 'download', 2);
    state.updateOpJobIds('op-1', ['job-1', 'job-2']);

    state.cancelOp('op-1');

    expect(api.cancelJob).toHaveBeenCalledWith('job-1');
    expect(api.cancelJob).toHaveBeenCalledWith('job-2');
  });
});

describe('clearOperationHistory', () => {
  it('removes completed/failed/cancelled/interrupted ops, keeps only running', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-running', 'Running', 'paste', 1);
    state.startOp('op-done', 'Done', 'move', 1);
    state.finishOp('op-done', 'done');
    state.startOp('op-error', 'Error', 'rename', 1);
    state.finishOp('op-error', 'error');
    state.startOp('op-cancelled', 'Cancelled', 'paste', 1);
    state.finishOp('op-cancelled', 'cancelled');

    state.clearOperationHistory();

    expect(state.operations).toHaveLength(1);
    expect(state.operations[0].id).toBe('op-running');
    expect(state.operations[0].status).toBe('running');
  });

  it('keeps all operations when all are running', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'Running', 'paste', 1);
    state.startOp('op-2', 'Also running', 'move', 1);

    state.clearOperationHistory();

    expect(state.operations).toHaveLength(2);
  });

  it('works with empty operations array', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());

    expect(() => state.clearOperationHistory()).not.toThrow();
    expect(state.operations).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group 5: Job polling (via reconcileInterruptedOps)
// ──────────────────────────────────────────────────────────────────────────────

describe('job polling via reconcileInterruptedOps', () => {
  it('marks interrupted ops as done when all jobs complete', async () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({ id: 'op-1', status: 'running', fileJobIds: ['job-1', 'job-2'], itemCount: 2 })
      ])
    );

    const state = new OperationsState(makeMockApi(), makeOpts());

    await vi.waitFor(() => {
      const op = state.operations.find((o) => o.id === 'op-1');
      expect(op?.status).toBe('done');
    });

    expect(state.operations[0].completedCount).toBe(2);
  });

  it('polls again when some jobs are still running', async () => {
    const pollJob = vi
      .fn()
      .mockResolvedValue({ status: 'running', progress: { completedBytes: 50 } });

    const api = makeMockApi();
    api.pollJob = pollJob;

    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({ id: 'op-1', status: 'running', fileJobIds: ['job-1'], itemCount: 3 })
      ])
    );

    const state = new OperationsState(api, makeOpts());

    await vi.waitFor(() => {
      const op = state.operations.find((o) => o.id === 'op-1');
      expect(op?.status).toBe('running');
    });

    expect(pollJob).toHaveBeenCalledWith('job-1');
    expect(state.operations[0].completedBytes).toBe(50);
  });

  it('does not poll when interrupted ops have no fileJobIds', () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([makeOp({ id: 'op-1', status: 'running' })])
    );

    const api = makeMockApi();
    const state = new OperationsState(api, makeOpts());

    expect(state.operations[0].status).toBe('interrupted');
    expect(api.pollJob).not.toHaveBeenCalled();
  });

  it('does not poll when interrupted ops have empty fileJobIds', () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([makeOp({ id: 'op-1', status: 'running', fileJobIds: [] })])
    );

    const api = makeMockApi();
    const state = new OperationsState(api, makeOpts());

    expect(state.operations[0].status).toBe('interrupted');
    expect(api.pollJob).not.toHaveBeenCalled();
  });

  it('does not reconcile non-interrupted ops (e.g. done)', () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([makeOp({ id: 'op-1', status: 'done', fileJobIds: ['job-1'] })])
    );

    const api = makeMockApi();
    const state = new OperationsState(api, makeOpts());

    expect(state.operations[0].status).toBe('done');
    expect(api.pollJob).not.toHaveBeenCalled();
  });

  it('marks op as error when not all jobs completed', async () => {
    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({ id: 'op-1', status: 'running', fileJobIds: ['job-1'], itemCount: 5 })
      ])
    );

    const state = new OperationsState(makeMockApi(), makeOpts());

    await vi.waitFor(() => {
      const op = state.operations.find((o) => o.id === 'op-1');
      expect(op?.status).toBe('error');
    });

    expect(state.operations[0].completedCount).toBe(1);
  });

  it('handles pollJob failures gracefully (marks op as error)', async () => {
    const api = makeMockApi();
    api.pollJob = vi.fn().mockRejectedValue(new Error('Network error'));

    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({ id: 'op-1', status: 'running', fileJobIds: ['job-1'], itemCount: 3 })
      ])
    );

    const state = new OperationsState(api, makeOpts());

    await vi.waitFor(() => {
      const op = state.operations.find((o) => o.id === 'op-1');
      expect(op?.status).toBe('error');
    });

    expect(state.operations[0].completedCount).toBe(0);
    expect(api.pollJob).toHaveBeenCalledWith('job-1');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group 6: Callbacks
// ──────────────────────────────────────────────────────────────────────────────

describe('callbacks', () => {
  it('onRefresh is called when destPath matches getBucket()/getPrefix()', async () => {
    const onRefresh = vi.fn();
    const api = makeMockApi();
    api.pollJob = vi.fn().mockResolvedValue({ status: 'done' });

    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({
          id: 'op-1',
          status: 'running',
          fileJobIds: ['job-1'],
          itemCount: 1,
          destPath: 'test-bucket/'
        })
      ])
    );

    new OperationsState(api, makeOpts({ onRefresh }));

    await vi.waitFor(() => {
      expect(onRefresh).toHaveBeenCalled();
    });
  });

  it('onRefresh is NOT called when destPath does not match', async () => {
    const onRefresh = vi.fn();
    const api = makeMockApi();
    api.pollJob = vi.fn().mockResolvedValue({ status: 'done' });

    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({
          id: 'op-1',
          status: 'running',
          fileJobIds: ['job-1'],
          itemCount: 1,
          destPath: 'other-bucket/'
        })
      ])
    );

    const state = new OperationsState(api, makeOpts({ onRefresh }));

    await vi.waitFor(() => {
      const op = state.operations.find((o) => o.id === 'op-1');
      return op?.status === 'done';
    });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('onInvalidateTabs is called when destPath is set', async () => {
    const onInvalidateTabs = vi.fn();
    const api = makeMockApi();
    api.pollJob = vi.fn().mockResolvedValue({ status: 'done' });

    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({
          id: 'op-1',
          status: 'running',
          fileJobIds: ['job-1'],
          itemCount: 1,
          destPath: 'test-bucket/some/path/'
        })
      ])
    );

    new OperationsState(api, makeOpts({ onInvalidateTabs }));

    await vi.waitFor(() => {
      expect(onInvalidateTabs).toHaveBeenCalledWith('some/path/');
    });
  });

  it('onInvalidateTabs is NOT called when destPath is undefined', async () => {
    const onInvalidateTabs = vi.fn();
    const api = makeMockApi();
    api.pollJob = vi.fn().mockResolvedValue({ status: 'done' });

    localStorage.setItem(
      OPERATIONS_HISTORY_KEY,
      JSON.stringify([
        makeOp({
          id: 'op-1',
          status: 'running',
          fileJobIds: ['job-1'],
          itemCount: 1,
          destPath: undefined
        })
      ])
    );

    const state = new OperationsState(api, makeOpts({ onInvalidateTabs }));

    await vi.waitFor(() => {
      const op = state.operations.find((o) => o.id === 'op-1');
      return op?.status === 'done';
    });

    expect(onInvalidateTabs).not.toHaveBeenCalled();
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Group 7: Multiple concurrent operations
// ──────────────────────────────────────────────────────────────────────────────

describe('multiple concurrent operations', () => {
  it('tracks two operations independently', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());

    state.startOp('op-1', 'First op', 'paste', 3);
    state.startOp('op-2', 'Second op', 'move', 5);

    expect(state.operations).toHaveLength(2);
    expect(state.operations[0].id).toBe('op-1');
    expect(state.operations[1].id).toBe('op-2');
  });

  it('updating progress on first op does not affect second', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'First', 'paste', 3, undefined, undefined, undefined, 300);
    state.startOp('op-2', 'Second', 'move', 5, undefined, undefined, undefined, 500);

    state.updateOpProgress('op-1', 2, 200, 'file.txt');

    const op1 = state.operations.find((o) => o.id === 'op-1')!;
    const op2 = state.operations.find((o) => o.id === 'op-2')!;

    expect(op1.completedCount).toBe(2);
    expect(op1.completedBytes).toBe(200);
    expect(op2.completedCount).toBe(0);
    expect(op2.completedBytes).toBe(0);
  });

  it('finishing first op does not affect the second', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'First', 'paste', 3);
    state.startOp('op-2', 'Second', 'move', 5);

    state.finishOp('op-1', 'done');

    const op1 = state.operations.find((o) => o.id === 'op-1')!;
    const op2 = state.operations.find((o) => o.id === 'op-2')!;

    expect(op1.status).toBe('done');
    expect(op2.status).toBe('running');
    expect(state.hasRunningOps).toBe(true);
  });

  it('finishing both ops results in hasRunningOps being false', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    state.startOp('op-1', 'First', 'paste', 1);
    state.startOp('op-2', 'Second', 'move', 1);

    state.finishOp('op-1', 'done');
    state.finishOp('op-2', 'error');

    expect(state.hasRunningOps).toBe(false);
  });

  it('cancelling one op does not affect the other', () => {
    const state = new OperationsState(makeMockApi(), makeOpts());
    const ctrl1 = new AbortController();
    const ctrl2 = new AbortController();
    state.startOp('op-1', 'First', 'paste', 1, ctrl1);
    state.startOp('op-2', 'Second', 'move', 1, ctrl2);

    state.cancelOp('op-1');

    expect(ctrl1.signal.aborted).toBe(true);
    expect(ctrl2.signal.aborted).toBe(false);
    expect(state.operations.find((o) => o.id === 'op-1')!.status).toBe('cancelled');
    expect(state.operations.find((o) => o.id === 'op-2')!.status).toBe('running');
  });
});
