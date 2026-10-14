import { logger } from '$lib/server/logging';
import { error } from '@sveltejs/kit';
import { z } from 'zod';

const log = logger.child({ module: 'job-store' });

export interface JobProgress {
  completedCount: number;
  completedBytes: number;
  currentFileName?: string;
}

interface JobEntry<T> {
  userId: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  result: T | null;
  error?: string;
  createdAt: number;
  /** Last progress update while running; time of completion once finished. */
  updatedAt: number;
  progress: JobProgress;
  /** Per-item results, recorded in every state, including after a cancel. */
  items: unknown[];
  /** A cancel was requested; for a job that settles itself the status is still `running`. */
  cancelRequested: boolean;
  /** Whether a cancel sets the final status, or the job settles itself via {@link finishJob}. */
  cancelSettles: boolean;
  cancel?: () => Promise<void> | void;
}

export interface CreateJobOptions {
  /** Whether the same user may reuse the ID of a job that is no longer running. Default `true`. */
  allowRestart?: boolean;
  /**
   * Whether a cancel immediately marks the job `cancelled`. Default `true`. A job
   * that still has work to report after a cancel (a transfer finishing its
   * deletes) passes `false` and calls {@link finishJob} when it really ends.
   */
  cancelSettles?: boolean;
}

const store = new Map<string, JobEntry<unknown>>();

// A running job expires only after this long without progress. Transfers that
// report no progress until they finish (e.g. a cross-provider copy) can still
// expire if they take longer than this.
const RUNNING_TTL = 30 * 60 * 1000;
// A finished job is kept this long after it finished, not after it started.
const DONE_TTL = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 60_000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store) {
      const ttl = entry.status === 'running' ? RUNNING_TTL : DONE_TTL;
      if (now - entry.updatedAt > ttl) {
        store.delete(id);
        log.trace({ job_id: id, status: entry.status }, 'cleaned up expired job');
      }
    }
  }, CLEANUP_INTERVAL);
  cleanupTimer.unref();
}

startCleanup();

/**
 * Create a new job entry. By default the same user may reuse the ID of a job
 * that is no longer running, so a browser retry of a failed download (same
 * URL, same job ID) can start again. With `allowRestart: false` every ID can
 * be used once, so a retried request never runs again.
 */
export function createJob(id: string, userId: string, options: CreateJobOptions = {}): void {
  const { allowRestart = true, cancelSettles = true } = options;
  if (!z.uuid().safeParse(id).success) throw error(400, 'Invalid job ID');
  const existing = store.get(id);
  if (existing && (!allowRestart || existing.userId !== userId || existing.status === 'running')) {
    throw error(409, 'Job already exists');
  }
  if (existing) log.debug({ job_id: id, previous_status: existing.status }, 'restarting job');
  store.set(id, {
    userId,
    status: 'running',
    result: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    progress: { completedCount: 0, completedBytes: 0 },
    items: [],
    cancelRequested: false,
    cancelSettles
  });
}

/** Attach a response stream's cancellation callback to a running job. */
export function setJobCancellation(id: string, cancel: () => Promise<void> | void): void {
  const entry = store.get(id);
  if (entry?.status === 'running') entry.cancel = cancel;
}

/**
 * Cancel a running job and its active work. A job created with
 * `cancelSettles: false` stays `running` until it calls {@link finishJob}.
 */
export async function cancelJob(id: string, userId: string): Promise<boolean> {
  const entry = store.get(id);
  if (!entry || entry.userId !== userId || entry.status !== 'running') return false;
  entry.cancelRequested = true;
  entry.updatedAt = Date.now();
  if (entry.cancelSettles) entry.status = 'cancelled';
  const cancel = entry.cancel;
  entry.cancel = undefined;
  await cancel?.();
  log.trace({ job_id: id, settled: entry.cancelSettles }, 'job cancel requested');
  return true;
}

/** Keep a running job from expiring while it works without reporting progress. */
export function touchJob(id: string): void {
  const entry = store.get(id);
  if (entry?.status === 'running') entry.updatedAt = Date.now();
}

/** Record the result of one item of a job, in any state. */
export function recordJobItem(id: string, item: unknown): void {
  const entry = store.get(id);
  if (!entry) return;
  entry.items.push(item);
  entry.updatedAt = Date.now();
}

/**
 * Settle a job created with `cancelSettles: false`: `cancelled` if a cancel
 * was requested, otherwise `done`. Stores the result either way.
 */
export function finishJob<T>(id: string, result: T): void {
  const entry = store.get(id);
  if (!entry || entry.status !== 'running') return;
  entry.status = entry.cancelRequested ? 'cancelled' : 'done';
  entry.updatedAt = Date.now();
  entry.cancel = undefined;
  (entry as JobEntry<T>).result = result;
  log.trace({ job_id: id, status: entry.status }, 'job finished');
}

/**
 * Update the progress of a running job.
 */
export function updateJobProgress(id: string, progress: Partial<JobProgress>): void {
  const entry = store.get(id);
  if (!entry || entry.status !== 'running') return;
  entry.updatedAt = Date.now();
  if (progress.completedCount !== undefined)
    entry.progress.completedCount = progress.completedCount;
  if (progress.completedBytes !== undefined)
    entry.progress.completedBytes = progress.completedBytes;
  if (progress.currentFileName !== undefined)
    entry.progress.currentFileName = progress.currentFileName;
}

/**
 * Mark a job as completed and store its result.
 */
export function completeJob<T>(id: string, result: T): void {
  const entry = store.get(id);
  if (!entry || entry.status !== 'running') return;
  entry.status = 'done' as const;
  entry.updatedAt = Date.now();
  entry.cancel = undefined;
  (entry as JobEntry<T>).result = result;
  log.trace({ job_id: id }, 'job completed');
}

/**
 * Mark a job as failed.
 */
export function failJob(id: string, error: string): void {
  const entry = store.get(id);
  if (!entry || entry.status !== 'running') return;
  entry.status = 'error' as const;
  entry.updatedAt = Date.now();
  entry.cancel = undefined;
  entry.error = error;
  log.trace({ job_id: id, error }, 'job failed');
}

/** Mark a job cancelled when the browser abandons its native download. */
export function cancelJobFromStream(id: string): void {
  const entry = store.get(id);
  if (!entry || entry.status !== 'running') return;
  entry.status = 'cancelled';
  entry.updatedAt = Date.now();
  entry.cancel = undefined;
  log.trace({ job_id: id }, 'job cancelled by download stream');
}

/**
 * Get the current state of a job. Returns null if not found (expired or never existed).
 */
export function getJob<T>(id: string, userId: string): JobEntry<T> | null {
  const entry = store.get(id);
  return entry?.userId === userId ? (entry as JobEntry<T>) : null;
}
