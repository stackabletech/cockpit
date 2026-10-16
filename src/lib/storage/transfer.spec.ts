vi.mock('$lib/stores/toast.svelte.js', () => ({
  addToast: vi.fn()
}));

import { describe, expect, it, vi } from 'vitest';
import { runTransfer } from './transfer.js';
import { createMemoryStorageApi } from './api.test-utils.js';
import type { OperationsState } from './operations.svelte.js';
import type { TransferEvent } from './transfer-types.js';

function fakeOperations() {
  return {
    startOp: vi.fn(),
    updateOpJobIds: vi.fn(),
    updateOpProgress: vi.fn(),
    finishOp: vi.fn()
  };
}

const done = (sourceKey: string) =>
  ({
    type: 'item-done',
    sourceKey,
    destRoot: `dest/${sourceKey}`,
    status: 'done',
    copied: 1,
    failed: [],
    deletedOriginals: 0
  }) satisfies TransferEvent;

describe('runTransfer', () => {
  it('counts the bytes of items whose events interleave', async () => {
    const events: TransferEvent[] = [
      { type: 'item-start', sourceKey: 'a', destRoot: 'dest/a', totalObjects: 1, totalBytes: 100 },
      { type: 'item-start', sourceKey: 'b', destRoot: 'dest/b', totalObjects: 1, totalBytes: 50 },
      { type: 'progress', sourceKey: 'a', copiedObjects: 0, copiedBytes: 40 },
      { type: 'progress', sourceKey: 'b', copiedObjects: 0, copiedBytes: 20 },
      done('b'),
      { type: 'progress', sourceKey: 'a', copiedObjects: 0, copiedBytes: 70 },
      done('a'),
      { type: 'complete', summary: { done: 2, partial: 0, failed: 0, refused: 0, cancelled: 0 } }
    ];
    const api = createMemoryStorageApi({
      async transfer(_body, onEvent) {
        for (const event of events) onEvent(event);
        return { complete: true };
      }
    });
    const operations = fakeOperations();

    await runTransfer({
      api,
      operations: operations as unknown as OperationsState,
      body: {
        op: 'copy',
        source: { bucket: 'x' },
        dest: { bucket: 'x', prefix: 'dest/' },
        items: [{ sourceKey: 'a' }, { sourceKey: 'b' }]
      },
      label: 'Copy',
      type: 'paste',
      destPath: 'x/dest/'
    });

    const progress = operations.updateOpProgress.mock.calls.map(
      ([, completed, bytes, name, total]) => ({ completed, bytes, name, total })
    );
    expect(progress).toEqual([
      { completed: 0, bytes: 0, name: 'a', total: 100 },
      { completed: 0, bytes: 0, name: 'b', total: 150 },
      { completed: 0, bytes: 40, name: 'b', total: 150 },
      { completed: 0, bytes: 60, name: 'b', total: 150 },
      { completed: 1, bytes: 90, name: 'a', total: 150 },
      { completed: 1, bytes: 120, name: 'a', total: 150 },
      { completed: 2, bytes: 150, name: 'a', total: 150 }
    ]);
  });
});
