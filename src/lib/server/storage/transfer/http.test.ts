import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createMockLogger } from '$lib/test-utils/mock-logger.js';
import type { StorageProvider } from '../provider.js';
import type { TransferRequest } from './resolve.js';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));
vi.mock('$lib/server/feature-flags.js', () => ({
  storagePasteEnabled: true,
  storageMoveEnabled: true,
  storageRenameEnabled: true
}));

const MINUTE = 60_000;

const request: TransferRequest = {
  op: 'copy',
  sourceBucket: 'b',
  destBucket: 'b',
  destPrefix: 'dest/',
  items: [{ sourceKey: 'a.txt' }]
};

/** Fresh modules under fake timers, with an engine the test settles itself. */
async function load() {
  vi.resetModules();
  let settle!: { resolve: () => void; reject: (err: Error) => void };
  const engine = new Promise<{ items: []; summary: Record<string, number> }>((resolve, reject) => {
    settle = {
      resolve: () =>
        resolve({
          items: [],
          summary: { done: 1, partial: 0, failed: 0, refused: 0, cancelled: 0 }
        }),
      reject
    };
  });
  vi.doMock('./execute.js', () => ({ executeTransfer: () => engine }));
  const http = await import('./http.js');
  const jobs = await import('../job-store.js');
  const start = (jobId = randomUUID()) => {
    http.streamTransfer({
      request,
      jobId,
      userId: 'owner',
      source: {} as StorageProvider,
      dest: {} as StorageProvider,
      concurrency: 1,
      logger: createMockLogger()
    });
    return jobId;
  };
  return { start, settle, jobs };
}

describe('streamTransfer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.doUnmock('./execute.js');
    vi.useRealTimers();
  });

  it('keeps a long transfer alive with a heartbeat, even without progress', async () => {
    const { start, settle, jobs } = await load();
    const jobId = start();

    // A single CopyObject can run longer than the 30-minute expiry without reporting anything.
    await vi.advanceTimersByTimeAsync(45 * MINUTE);
    expect(jobs.getJob(jobId, 'owner')?.status).toBe('running');

    settle.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(jobs.getJob(jobId, 'owner')?.status).toBe('done');
    // The heartbeat stops with the transfer, so the finished job expires as usual.
    await vi.advanceTimersByTimeAsync(7 * MINUTE);
    expect(jobs.getJob(jobId, 'owner')).toBeNull();
  });

  it('ends the job as error when the engine crashes', async () => {
    const { start, settle, jobs } = await load();
    const jobId = start();

    settle.reject(new Error('bug'));
    await vi.advanceTimersByTimeAsync(0);

    expect(jobs.getJob(jobId, 'owner')).toMatchObject({
      status: 'error',
      error: 'Transfer crashed'
    });
  });
});
