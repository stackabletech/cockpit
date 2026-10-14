import { beforeEach, describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import {
  memoryProvider,
  memoryStore,
  type MemoryStore
} from '$lib/server/storage/transfer/memory-provider.test-utils.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';

const { flags, state } = vi.hoisted(() => ({
  flags: { paste: true, move: true },
  state: {
    store: null as unknown as MemoryStore,
    wrap: (provider: StorageProvider) => provider
  }
}));
vi.mock('$lib/server/feature-flags.js', () => ({
  get storagePasteEnabled() {
    return flags.paste;
  },
  get storageMoveEnabled() {
    return flags.move;
  },
  storageRenameEnabled: true,
  storageTransferConcurrency: 2
}));
vi.mock('$lib/server/storage/request-context.js', () => ({
  createStorageProviderForBucket: (_event: unknown, bucket: string) =>
    state.wrap(memoryProvider(state.store, bucket))
}));

import { POST } from './+server.js';
import { createMockLogger } from '$lib/test-utils/mock-logger.js';

function event(body: unknown) {
  return {
    request: new Request('http://localhost/api/storage/transfer/plan', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    locals: { logger: createMockLogger(), user: { id: 'u' } }
  } as unknown as Parameters<typeof POST>[0];
}

const plan = (keys: string[], prefix = 'dest/', op = 'copy') => ({
  op,
  source: { bucket: 'b', keys },
  dest: { bucket: 'b', prefix }
});

describe('POST /api/storage/transfer/plan', () => {
  beforeEach(() => {
    Object.assign(flags, { paste: true, move: true });
    state.store = memoryStore({ b: ['a.txt', 'docs/', 'dest/a.txt', 'dest/docs/x'] });
    state.wrap = (provider) => provider;
  });

  it('previews conflicts, self-conflicts and refusals', async () => {
    const response = await POST(event(plan(['a.txt', 'docs/', 'dest/a.txt', 'new.txt'])));

    expect(await response.json()).toEqual({
      items: [
        {
          sourceKey: 'a.txt',
          kind: 'file',
          destKey: 'dest/a.txt',
          conflict: 'file',
          refused: 'overlaps_source',
          suggestedName: 'a (1).txt'
        },
        {
          sourceKey: 'docs/',
          kind: 'folder',
          destKey: 'dest/docs/',
          conflict: 'folder',
          suggestedName: 'docs (1)'
        },
        {
          sourceKey: 'dest/a.txt',
          kind: 'file',
          destKey: 'dest/a.txt',
          conflict: 'file',
          selfConflict: true,
          suggestedName: 'a (1).txt'
        },
        { sourceKey: 'new.txt', kind: 'file', destKey: 'dest/new.txt', conflict: 'none' }
      ]
    });
  });

  it('refuses a cut pasted into its own folder', async () => {
    const response = await POST(event(plan(['dest/a.txt'], 'dest/', 'move')));
    const { items } = await response.json();
    expect(items[0].refused).toBe('same_location');
  });

  it('answers 400 for invalid bodies and overlapping sources', async () => {
    await expect(POST(event({ op: 'rename' }))).rejects.toMatchObject({ status: 400 });
    await expect(POST(event(plan(['docs/', 'docs/a'])))).rejects.toMatchObject({ status: 400 });
  });

  it.each([
    ['copy', { paste: false, move: true }],
    ['move', { paste: false, move: false }]
  ])('answers 404 when the previewed %s is disabled', async (op, flagState) => {
    Object.assign(flags, flagState);
    await expect(POST(event(plan(['a.txt'], 'dest/', op)))).rejects.toMatchObject({
      status: 404
    });
  });

  it('passes storage errors through as HTTP errors', async () => {
    state.wrap = (provider) => ({
      ...provider,
      exists: async () => {
        throw error(403, 'Access denied');
      }
    });
    await expect(POST(event(plan(['a.txt'])))).rejects.toMatchObject({ status: 403 });
  });
});
