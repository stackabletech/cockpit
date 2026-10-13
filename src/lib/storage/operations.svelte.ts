import { SvelteMap } from 'svelte/reactivity';
import { browser } from '$app/environment';
import type { StorageOperation } from '$lib/storage/types.js';
import type { JobStatus, StorageApi } from './api.js';

// ── Page-unloading flag ─────────────────────────────────────────────────────

export let pageUnloading = false;
if (browser) {
  window.addEventListener('beforeunload', () => {
    pageUnloading = true;
  });
}

// ── Operations history localStorage helpers ───────────────────────────────────

const OPERATIONS_HISTORY_KEY = 'storage_operations_history';
const MAX_HISTORY_ENTRIES = 30;
const JOB_START_GRACE_MS = 60_000;

function loadPersistedOperations(): StorageOperation[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(OPERATIONS_HISTORY_KEY);
    if (!raw) return [];
    const ops = JSON.parse(raw) as StorageOperation[];
    if (!Array.isArray(ops)) return [];
    return ops.map((op) =>
      op.status === 'running'
        ? { ...op, status: 'interrupted' as const, completedAt: op.completedAt ?? Date.now() }
        : op
    );
  } catch {
    return [];
  }
}

function saveOperationsToStorage(ops: StorageOperation[]): void {
  if (!browser) return;
  try {
    const history = ops.filter((op) => op.status !== 'running').slice(-MAX_HISTORY_ENTRIES);
    const running = ops.filter((op) => op.status === 'running');
    const toSave = [...running, ...history].slice(-MAX_HISTORY_ENTRIES);
    localStorage.setItem(OPERATIONS_HISTORY_KEY, JSON.stringify(toSave));
  } catch {
    // Best effort.
  }
}

// ── OperationsState ─────────────────────────────────────────────────────────

export interface OperationsStateOpts {
  getBucket: () => string;
  getPrefix: () => string;
  onRefresh?: () => void;
  onInvalidateTabs?: (prefix: string) => void;
}

export class OperationsState {
  operations = $state<StorageOperation[]>([]);
  hasRunningOps = $derived(this.operations.some((op) => op.status === 'running'));

  private _abortControllers = new SvelteMap<string, AbortController>();
  private _pollTimers = new SvelteMap<string, ReturnType<typeof setTimeout>>();
  // When each job was first reported missing, to tell a download the browser
  // has not started yet apart from a job that expired or never existed.
  private _jobMissingSince = new SvelteMap<string, number>();
  // The last status the server reported for each job. The server forgets
  // finished jobs after a while, so a job that has gone missing keeps the
  // outcome it was last seen with instead of counting as failed.
  private _lastKnownJobs = new SvelteMap<string, JobStatus>();
  private _api: StorageApi;
  private _getBucket: () => string;
  private _getPrefix: () => string;
  private _onRefresh?: () => void;
  private _onInvalidateTabs?: (prefix: string) => void;

  constructor(api: StorageApi, opts: OperationsStateOpts) {
    this._api = api;
    this._getBucket = opts.getBucket;
    this._getPrefix = opts.getPrefix;
    this._onRefresh = opts.onRefresh;
    this._onInvalidateTabs = opts.onInvalidateTabs;
    this.operations = loadPersistedOperations();
    void this.reconcileInterruptedOps();
  }

  startOp(
    id: string,
    label: string,
    type: StorageOperation['type'],
    itemCount: number,
    abortController?: AbortController,
    destPath?: string,
    sourceNames?: string[],
    totalBytes = 0,
    persist = true
  ): void {
    this.operations = [
      ...this.operations,
      {
        id,
        label,
        status: 'running',
        type,
        itemCount,
        completedCount: 0,
        startedAt: Date.now(),
        destPath,
        sourceNames,
        totalBytes,
        completedBytes: 0
      }
    ];
    if (abortController) {
      this._abortControllers.set(id, abortController);
    }
    if (persist) saveOperationsToStorage(this.operations);
  }

  updateOpProgress(
    id: string,
    completedCount: number,
    completedBytes: number,
    currentFileName?: string,
    totalBytes?: number
  ): void {
    this.operations = this.operations.map((op) =>
      op.id === id && op.status !== 'cancelled'
        ? {
            ...op,
            completedCount,
            completedBytes,
            currentFileName,
            totalBytes: totalBytes ?? op.totalBytes
          }
        : op
    );
  }

  updateOpJobIds(id: string, fileJobIds: string[]): void {
    this.operations = this.operations.map((op) => (op.id === id ? { ...op, fileJobIds } : op));
    saveOperationsToStorage(this.operations);
  }

  trackDownload(id: string): void {
    const operation = this.operations.find((op) => op.id === id);
    // Native downloads begin asynchronously after their anchor click. Wait for
    // the first request to register its server-side job before polling it.
    if (operation?.status === 'running' && operation.fileJobIds?.length) {
      const timer = setTimeout(() => void this._pollJobStatus(operation), 500);
      this._pollTimers.set(id, timer);
    }
  }

  /** Refine the expected transfer size once the download manifest is known. */
  updateOpTotalBytes(id: string, totalBytes: number): void {
    this.operations = this.operations.map((op) => (op.id === id ? { ...op, totalBytes } : op));
  }

  finishOp(id: string, status: 'done' | 'error' | 'cancelled', errorMessage?: string): void {
    clearTimeout(this._pollTimers.get(id));
    this._pollTimers.delete(id);
    const operation = this.operations.find((op) => op.id === id);
    this.operations = this.operations.map((op) =>
      op.id === id && op.status !== 'cancelled'
        ? { ...op, status, errorMessage, completedAt: Date.now() }
        : op
    );
    this._abortControllers.delete(id);
    if (operation?.type !== 'download') saveOperationsToStorage(this.operations);
  }

  removeOp(id: string): void {
    clearTimeout(this._pollTimers.get(id));
    this._pollTimers.delete(id);
    this.operations = this.operations.filter((op) => op.id !== id);
    this._abortControllers.delete(id);
    saveOperationsToStorage(this.operations);
  }

  cancelOp(id: string): void {
    const operation = this.operations.find((op) => op.id === id);
    const controller = this._abortControllers.get(id);
    if (controller) {
      controller.abort();
    }
    if (operation?.type === 'download') {
      for (const jobId of operation.fileJobIds ?? [])
        void this._api.cancelJob(jobId).catch(() => {});
    }
    const timer = this._pollTimers.get(id);
    if (timer) {
      clearTimeout(timer);
      this._pollTimers.delete(id);
    }
    this.finishOp(id, 'cancelled');
  }

  clearOperationHistory(): void {
    this.operations = this.operations.filter((op) => op.status === 'running');
    saveOperationsToStorage(this.operations);
  }

  private async reconcileInterruptedOps(): Promise<void> {
    const interrupted = this.operations.filter(
      (op) => op.status === 'interrupted' && op.fileJobIds && op.fileJobIds.length > 0
    );
    if (interrupted.length === 0) return;

    for (const op of interrupted) {
      void this._pollJobStatus(op);
    }
  }

  private async _pollJobStatus(op: StorageOperation): Promise<void> {
    const isActive = () =>
      ['running', 'interrupted'].includes(
        this.operations.find((o) => o.id === op.id)?.status ?? ''
      );
    if (!isActive()) return;

    let completedCount = 0;
    let completedBytes = 0;
    let anyRunning = false;
    let anyError = false;
    let anyCancelled = false;
    let anyUnknown = false;
    let currentFileName: string | undefined;

    for (const jobId of op.fileJobIds!) {
      try {
        let job = await this._api.pollJob(jobId);
        const lastKnown = this._lastKnownJobs.get(jobId);
        if (job.status !== 'not_found') {
          this._jobMissingSince.delete(jobId);
          this._lastKnownJobs.set(jobId, job);
        } else if (lastKnown && lastKnown.status !== 'running') {
          job = lastKnown;
        }
        completedBytes += (job.progress ?? lastKnown?.progress)?.completedBytes ?? 0;
        if (job.status === 'done') {
          completedCount++;
        } else if (job.status === 'running') {
          anyRunning = true;
          currentFileName = job.progress?.currentFileName;
        } else if (job.status === 'not_found') {
          // The browser may not have opened the native download request yet
          // (e.g. a save dialog is open). Give up after a grace period. A job
          // that disappeared while running has an unknown outcome straight away.
          const missingSince = this._jobMissingSince.get(jobId) ?? Date.now();
          this._jobMissingSince.set(jobId, missingSince);
          if (!lastKnown && Date.now() - missingSince < JOB_START_GRACE_MS) anyRunning = true;
          else anyUnknown = true;
        } else if (job.status === 'cancelled') {
          anyCancelled = true;
        } else {
          anyError = true;
        }
      } catch {
        // Job may have expired
      }
    }

    if (!isActive()) return;
    if (anyRunning) {
      this.operations = this.operations.map((o) =>
        o.id === op.id
          ? {
              ...o,
              status: 'running' as const,
              completedCount,
              completedBytes,
              currentFileName,
              completedAt: undefined
            }
          : o
      );
      const timer = setTimeout(() => void this._pollJobStatus(op), 2000);
      this._pollTimers.set(op.id, timer);
    } else {
      this.operations = this.operations.map((o) =>
        o.id === op.id
          ? {
              ...o,
              status: (anyCancelled
                ? 'cancelled'
                : anyError
                  ? 'error'
                  : anyUnknown
                    ? 'unknown'
                    : completedCount !==
                        (op.type === 'download' ? op.fileJobIds!.length : op.itemCount)
                      ? 'error'
                      : 'done') as 'done' | 'error' | 'cancelled' | 'unknown',
              completedCount,
              completedBytes,
              completedAt: Date.now()
            }
          : o
      );
      saveOperationsToStorage(this.operations);
      for (const jobId of op.fileJobIds!) {
        this._jobMissingSince.delete(jobId);
        this._lastKnownJobs.delete(jobId);
      }

      const existing = this._pollTimers.get(op.id);
      if (existing) {
        clearTimeout(existing);
        this._pollTimers.delete(op.id);
      }

      const bucket = this._getBucket();
      const prefix = this._getPrefix();
      if (op.destPath && `${bucket}/${prefix}`.startsWith(op.destPath)) {
        this._onRefresh?.();
      }

      if (op.destPath && this._onInvalidateTabs) {
        const slashIdx = op.destPath.indexOf('/');
        if (slashIdx !== -1) {
          const p = op.destPath.slice(slashIdx + 1);
          this._onInvalidateTabs(p.endsWith('/') ? p : p + '/');
        }
      }
    }
  }
}
