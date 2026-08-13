import { describe, expect, it, vi } from 'vitest';
import { downloadsNeedArchive, startDownload } from './download.js';
import type { StorageApi } from './api.js';

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
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    });
    const api = {
      createDownloadJob: async () => ({
        id: 'job-1',
        status: 'ready' as const,
        totalBytes: 10,
        progress: { completedCount: 2, completedBytes: 10 },
        files: []
      }),
      pollDownloadJob: async () => ({
        id: 'job-1',
        status: 'ready' as const,
        totalBytes: 10,
        progress: { completedCount: 2, completedBytes: 10 },
        files: []
      })
    } as StorageApi;
    const completed: string[] = [];

    await startDownload(
      api,
      'bucket',
      'folder/',
      ['one.txt', 'two.txt'],
      'connection',
      () => {},
      () => {},
      (id) => {
        completed.push(id);
      }
    );

    expect(completed).toEqual(['job-1']);
    vi.unstubAllGlobals();
  });
});
