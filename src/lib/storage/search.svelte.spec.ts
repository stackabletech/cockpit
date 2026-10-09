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
  it('closes interrupted sessions coherently and prevents late result updates', async () => {
    const response = deferred<{ results: [] }>();
    let update: ((update: StorageSearchUpdate) => void) | undefined;
    const state = new StorageSearchState({
      api: createMemoryStorageApi({
        async search({ onUpdate }) {
          update = onUpdate;
          return response.promise;
        }
      }),
      getBuckets: () => ['documents'],
      getCurrentBucket: () => 'documents'
    });
    state.updateSession('s1', { query: 'report' });
    const running = state.run('s1');
    state.close();
    update?.({
      snapshot: false,
      results: [{ key: 'late.txt', size: 1, lastModified: new Date(), isDirectory: false }]
    });
    response.resolve({ results: [] });
    await running;
    expect(state.active?.status).toBe('idle');
    expect(state.active?.results).toEqual([]);
  });
  it('bounds bucket searches to four concurrent requests', async () => {
    const gates: ReturnType<typeof deferred<{ results: [] }>>[] = [];
    const state = new StorageSearchState({
      api: createMemoryStorageApi({
        async search() {
          const gate = deferred<{ results: [] }>();
          gates.push(gate);
          return gate.promise;
        }
      }),
      getBuckets: () => ['a', 'b', 'c', 'd', 'e', 'f'],
      getCurrentBucket: () => undefined
    });
    state.updateSession('s1', { query: 'report' });
    const running = state.run('s1');
    expect(gates).toHaveLength(4);
    for (const gate of gates) gate.resolve({ results: [] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gates).toHaveLength(6);
    for (const gate of gates) gate.resolve({ results: [] });
    await running;
    expect(state.active?.status).toBe('done');
  });
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
