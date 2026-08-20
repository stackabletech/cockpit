import { SvelteMap } from 'svelte/reactivity';
import { browser } from '$app/environment';
import type { StorageOperation } from '$lib/storage/types.js';
import type { StorageApi } from './api.js';

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
    totalBytes = 0
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
    saveOperationsToStorage(this.operations);
  }

  updateOpProgress(
    id: string,
    completedCount: number,
    completedBytes: number,
    currentFileName?: string,
    activeFiles?: string[],
    totalBytes?: number
  ): void {
    this.operations = this.operations.map((op) =>
      op.id === id && op.status !== 'cancelled'
        ? {
            ...op,
            completedCount,
            completedBytes,
            currentFileName,
            activeFiles: activeFiles && activeFiles.length > 0 ? activeFiles : undefined,
            totalBytes: totalBytes ?? op.totalBytes
          }
        : op
    );
  }

  resumeDownloadOp(id: string, totalBytes: number): void {
    this.operations = this.operations.map((op) =>
      op.id === id && op.type === 'download' && op.status === 'interrupted'
        ? { ...op, status: 'running' as const, completedAt: undefined, totalBytes }
        : op
    );
    saveOperationsToStorage(this.operations);
  }

  setDownloadCacheExpiry(id: string, cacheExpiresAt: number | undefined): void {
    this.operations = this.operations.map((op) =>
      op.id === id && op.type === 'download' ? { ...op, cacheExpiresAt } : op
    );
    saveOperationsToStorage(this.operations);
  }

  updateOpJobIds(id: string, fileJobIds: string[]): void {
    this.operations = this.operations.map((op) => (op.id === id ? { ...op, fileJobIds } : op));
    saveOperationsToStorage(this.operations);
  }

  finishOp(id: string, status: 'done' | 'error' | 'cancelled', errorMessage?: string): void {
    this.operations = this.operations.map((op) =>
      op.id === id && op.status !== 'cancelled'
        ? { ...op, status, errorMessage, completedAt: Date.now() }
        : op
    );
    this._abortControllers.delete(id);
    saveOperationsToStorage(this.operations);
  }

  startDownloadOp(
    id: string,
    label: string,
    itemCount: number,
    sourceNames: string[],
    totalBytes: number,
    abortController?: AbortController
  ): void {
    this.startOp(
      id,
      label,
      'download',
      itemCount,
      abortController,
      undefined,
      sourceNames,
      totalBytes
    );
  }

  cancelOp(id: string): void {
    const op = this.operations.find((o) => o.id === id);
    if (op?.type === 'download') {
      const request = this._api.cancelDownloadJob?.(id);
      request?.catch?.(() => {
        // Best effort — the local op is cancelled regardless.
      });
    }
    const controller = this._abortControllers.get(id);
    if (controller) {
      controller.abort();
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
    if (this.operations.find((o) => o.id === op.id)?.status === 'cancelled') return;

    let completedCount = 0;
    let completedBytes = 0;
    let anyRunning = false;

    for (const jobId of op.fileJobIds!) {
      try {
        const job = await this._api.pollJob(jobId);
        if (job.status === 'done') {
          completedCount++;
        } else if (job.status === 'running') {
          anyRunning = true;
          completedBytes += job.progress?.completedBytes ?? 0;
        }
      } catch {
        // Job may have expired
      }
    }

    if (anyRunning) {
      this.operations = this.operations.map((o) =>
        o.id === op.id
          ? {
              ...o,
              status: 'running' as const,
              completedCount,
              completedBytes,
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
              status: (completedCount === op.itemCount ? 'done' : 'error') as 'done' | 'error',
              completedCount,
              completedBytes,
              completedAt: Date.now()
            }
          : o
      );
      saveOperationsToStorage(this.operations);

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
