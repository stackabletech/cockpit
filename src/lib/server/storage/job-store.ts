import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'job-store' });

export interface JobProgress {
  completedCount: number;
  completedBytes: number;
  currentFileName?: string;
}

interface JobEntry<T> {
  status: 'running' | 'done' | 'error';
  result: T | null;
  error?: string;
  createdAt: number;
  progress: JobProgress;
}

const store = new Map<string, JobEntry<unknown>>();

const RUNNING_TTL = 30 * 60 * 1000;
const DONE_TTL = 5 * 60 * 1000;
const CLEANUP_INTERVAL = 60_000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of store) {
      const ttl = entry.status === 'running' ? RUNNING_TTL : DONE_TTL;
      if (now - entry.createdAt > ttl) {
        store.delete(id);
        log.trace({ job_id: id, status: entry.status }, 'cleaned up expired job');
      }
    }
  }, CLEANUP_INTERVAL);
}

startCleanup();

/**
 * Create a new job entry.
 */
export function createJob(id: string): void {
  store.set(id, {
    status: 'running',
    result: null,
    createdAt: Date.now(),
    progress: { completedCount: 0, completedBytes: 0 }
  });
}

/**
 * Update the progress of a running job.
 */
export function updateJobProgress(id: string, progress: Partial<JobProgress>): void {
  const entry = store.get(id);
  if (!entry || entry.status !== 'running') return;
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
  if (!entry) return;
  entry.status = 'done' as const;
  (entry as JobEntry<T>).result = result;
  log.trace({ job_id: id }, 'job completed');
}

/**
 * Mark a job as failed.
 */
export function failJob(id: string, error: string): void {
  const entry = store.get(id);
  if (!entry) return;
  entry.status = 'error' as const;
  entry.error = error;
  log.trace({ job_id: id, error }, 'job failed');
}

/**
 * Get the current state of a job. Returns null if not found (expired or never existed).
 */
export function getJob<T>(id: string): JobEntry<T> | null {
  return (store.get(id) as JobEntry<T>) ?? null;
}
