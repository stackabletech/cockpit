import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  createJob,
  getJob,
  cancelJob,
  completeJob,
  failJob,
  setJobCancellation
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
