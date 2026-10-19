import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createJob,
  getJob,
  cancelJob,
  completeJob,
  failJob,
  setJobCancellation,
  recordJobItem,
  finishJob
} from './job-store.js';

describe('job ownership and lifecycle', () => {
  it('rejects invalid identifiers and prevents replacement', () => {
    expect(() => createJob('invalid', 'owner')).toThrow();
    const id = randomUUID();
    createJob(id, 'owner');
    expect(() => createJob(id, 'another')).toThrow();
    expect(getJob(id, 'owner')?.status).toBe('running');
  });
  it('lets the same user restart a job that is no longer running', () => {
    const id = randomUUID();
    createJob(id, 'owner');
    expect(() => createJob(id, 'owner')).toThrow();

    failJob(id, 'connection reset');
    expect(() => createJob(id, 'another')).toThrow();
    createJob(id, 'owner');
    expect(getJob(id, 'owner')?.status).toBe('running');
    expect(getJob(id, 'owner')?.error).toBeUndefined();
  });
  it('does not allow another user to inspect or cancel a job', async () => {
    const id = randomUUID();
    createJob(id, 'owner');
    expect(getJob(id, 'another')).toBeNull();
    expect(await cancelJob(id, 'another')).toBe(false);
    expect(getJob(id, 'owner')?.status).toBe('running');
  });
  it('releases stream cancellation closures in every terminal state', async () => {
    for (const status of ['done', 'error', 'cancelled']) {
      const id = randomUUID();
      createJob(id, 'owner');
      setJobCancellation(id, () => {});
      if (status === 'done') completeJob(id, null);
      else if (status === 'error') failJob(id, 'failed');
      else await cancelJob(id, 'owner');
      expect(getJob(id, 'owner')?.cancel).toBeUndefined();
    }
  });
});

describe('jobs that settle themselves', () => {
  it('refuses to reuse a job ID when restarts are not allowed', () => {
    const id = randomUUID();
    createJob(id, 'owner', { allowRestart: false });
    finishJob(id, null);
    expect(() => createJob(id, 'owner', { allowRestart: false })).toThrow(
      expect.objectContaining({ status: 409 })
    );
  });

  it('tracks a cancel request separately from the final status', async () => {
    const id = randomUUID();
    const cancel = vi.fn();
    createJob(id, 'owner', { allowRestart: false, cancelSettles: false });
    setJobCancellation(id, cancel);

    expect(await cancelJob(id, 'owner')).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
    expect(getJob(id, 'owner')).toMatchObject({ status: 'running', cancelRequested: true });

    recordJobItem(id, { sourceKey: 'a', status: 'done' });
    finishJob(id, { done: 1 });
    expect(getJob(id, 'owner')).toMatchObject({
      status: 'cancelled',
      result: { done: 1 },
      items: [{ sourceKey: 'a', status: 'done' }]
    });
  });

  it('finishes as done without a cancel request', () => {
    const id = randomUUID();
    createJob(id, 'owner', { cancelSettles: false });
    finishJob(id, null);
    expect(getJob(id, 'owner')?.status).toBe('done');
  });

  it('records item results in every state', async () => {
    const id = randomUUID();
    createJob(id, 'owner');
    await cancelJob(id, 'owner');
    recordJobItem(id, { sourceKey: 'late' });
    expect(getJob(id, 'owner')).toMatchObject({
      status: 'cancelled',
      items: [{ sourceKey: 'late' }]
    });
  });
});

describe('job expiry', () => {
  const MINUTE = 60_000;

  async function freshStore() {
    vi.resetModules();
    return import('./job-store.js');
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a running job while it keeps reporting progress', async () => {
    const store = await freshStore();
    const id = randomUUID();
    store.createJob(id, 'owner');
    for (let minute = 1; minute <= 45; minute++) {
      await vi.advanceTimersByTimeAsync(MINUTE);
      store.updateJobProgress(id, { completedBytes: minute });
    }
    expect(store.getJob(id, 'owner')?.status).toBe('running');
  });

  it('keeps a running job alive with a heartbeat', async () => {
    const store = await freshStore();
    const id = randomUUID();
    store.createJob(id, 'owner');
    for (let minute = 1; minute <= 45; minute++) {
      await vi.advanceTimersByTimeAsync(MINUTE);
      store.touchJob(id);
    }
    expect(store.getJob(id, 'owner')?.status).toBe('running');
  });

  it('expires a running job after 30 minutes without progress', async () => {
    const store = await freshStore();
    const id = randomUUID();
    store.createJob(id, 'owner');
    await vi.advanceTimersByTimeAsync(29 * MINUTE);
    expect(store.getJob(id, 'owner')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(2 * MINUTE + 1);
    expect(store.getJob(id, 'owner')).toBeNull();
  });

  it('retains a finished job for five minutes counted from completion', async () => {
    const store = await freshStore();
    const id = randomUUID();
    store.createJob(id, 'owner');
    await vi.advanceTimersByTimeAsync(10 * MINUTE);
    store.completeJob(id, null);
    await vi.advanceTimersByTimeAsync(4 * MINUTE);
    expect(store.getJob(id, 'owner')?.status).toBe('done');
    await vi.advanceTimersByTimeAsync(2 * MINUTE + 1);
    expect(store.getJob(id, 'owner')).toBeNull();
  });
});
