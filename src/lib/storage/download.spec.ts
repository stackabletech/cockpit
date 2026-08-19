import { describe, expect, it, vi } from 'vitest';
import { downloadsNeedArchive, startDownload } from './download.js';
import { createMemoryStorageApi } from './api.test-utils.js';
import type { DownloadJobStatus } from './api.js';

function stubLocalStorage(): void {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
}

function runningJob(): DownloadJobStatus {
  return {
    id: 'job-1',
    status: 'running',
    totalBytes: 10,
    progress: { completedCount: 0, completedBytes: 0 },
    files: []
  };
}

describe('downloadsNeedArchive', () => {
  it('keeps up to three file-only selections as individual downloads', () => {
    expect(downloadsNeedArchive(['one.txt', 'two.txt', 'three.txt'])).toBe(false);
  });

  it('archives selections larger than three files', () => {
    expect(downloadsNeedArchive(['one.txt', 'two.txt', 'three.txt', 'four.txt'])).toBe(true);
  });

  it('always archives a directory selection', () => {
    expect(downloadsNeedArchive(['reports/', 'summary.csv'])).toBe(true);
  });

  it('stops polling and marks a ready download complete', async () => {
    stubLocalStorage();
    const readyJob: DownloadJobStatus = {
      id: 'job-1',
      status: 'ready',
      totalBytes: 10,
      expiresAt: Date.now() + 60_000,
      progress: { completedCount: 2, completedBytes: 10 },
      files: []
    };
    const api = createMemoryStorageApi({
      createDownloadJob: async () => readyJob,
      pollDownloadJob: async () => readyJob
    });
    const completed: Array<{ id: string }> = [];

    await startDownload(
      api,
      'bucket',
      'folder/',
      ['one.txt', 'two.txt'],
      'connection',
      undefined,
      () => {},
      () => {},
      (job) => {
        completed.push(job);
      }
    );

    expect(completed.map((job) => job.id)).toEqual(['job-1']);
    vi.unstubAllGlobals();
  });

  it('stops polling when the download is cancelled via the abort signal', async () => {
    vi.useFakeTimers();
    stubLocalStorage();
    const poll = vi.fn(async () => runningJob());
    const api = createMemoryStorageApi({
      createDownloadJob: async () => runningJob(),
      pollDownloadJob: poll
    });
    const controller = new AbortController();
    const updates: Array<{ phase?: 'downloading' | 'compressing'; status: string }> = [];

    const promise = startDownload(
      api,
      'bucket',
      'folder/',
      ['one.txt', 'two.txt'],
      'connection',
      controller.signal,
      () => {},
      (job) => updates.push(job),
      () => {}
    );

    await Promise.resolve();
    await Promise.resolve();
    expect(poll).toHaveBeenCalledTimes(1);

    controller.abort();
    await vi.advanceTimersByTimeAsync(1_500);

    await promise;
    expect(poll).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stops silently when the server reports the job cancelled', async () => {
    stubLocalStorage();
    const cancelledJob: DownloadJobStatus = { ...runningJob(), status: 'cancelled' };
    const api = createMemoryStorageApi({
      createDownloadJob: async () => cancelledJob,
      pollDownloadJob: async () => cancelledJob
    });
    const updates: Array<{ status: string }> = [];

    await startDownload(
      api,
      'bucket',
      'folder/',
      ['one.txt', 'two.txt'],
      'connection',
      undefined,
      () => {},
      (job) => updates.push(job),
      () => {
        throw new Error('should not complete a cancelled job');
      }
    );

    expect(updates[0]?.status).toBe('cancelled');
    vi.unstubAllGlobals();
  });
});
