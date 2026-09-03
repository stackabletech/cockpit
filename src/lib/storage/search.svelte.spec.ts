import { describe, expect, it } from 'vitest';
import { StorageSearchState } from './search.svelte.js';
import { createMemoryStorageApi } from './api.test-utils.js';
import type { StorageSearchUpdate } from './types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('StorageSearchState', () => {
  it('adds streamed matches before the search completes', async () => {
    const response = deferred<{ results: [] }>();
    const api = createMemoryStorageApi({
      async search({ onUpdate }) {
        onUpdate?.({
          snapshot: false,
          results: [
            {
              key: 'report.csv',
              size: 10,
              lastModified: new Date('2026-01-01'),
              isDirectory: false
            }
          ]
        } satisfies StorageSearchUpdate);
        return response.promise;
      }
    });
    const state = new StorageSearchState({
      api,
      getBuckets: () => ['documents'],
      getCurrentBucket: () => 'documents'
    });
    state.updateSession('s1', { query: 'report' });

    const running = state.run('s1');

    expect(state.active?.results).toEqual([expect.objectContaining({ bucket: 'documents' })]);
    expect(state.active?.status).toBe('running');

    response.resolve({ results: [] });
    await running;
  });

  it('keeps streamed matches when a running search is cancelled', async () => {
    const response = deferred<{ results: [] }>();
    const api = createMemoryStorageApi({
      async search({ onUpdate }) {
        onUpdate?.({
          snapshot: false,
          results: [
            {
              key: 'report.csv',
              size: 10,
              lastModified: new Date('2026-01-01'),
              isDirectory: false
            }
          ]
        });
        return response.promise;
      }
    });
    const state = new StorageSearchState({
      api,
      getBuckets: () => ['documents'],
      getCurrentBucket: () => 'documents'
    });
    state.updateSession('s1', { query: 'report' });

    void state.run('s1');
    state.cancel('s1');

    expect(state.active?.status).toBe('done');
    expect(state.active?.results).toEqual([expect.objectContaining({ key: 'report.csv' })]);
  });
});
