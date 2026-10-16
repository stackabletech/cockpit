import { describe, expect, it, vi } from 'vitest';
import { error } from '@sveltejs/kit';
import { executeTransfer, type TransferContext } from './execute.js';
import type { TransferRequest } from './resolve.js';
import {
  keysOf,
  memoryProvider,
  memoryStore,
  type MemoryStore
} from './memory-provider.test-utils.js';
import { createMockLogger } from '$lib/test-utils/mock-logger.js';
import type { TransferEvent, TransferItemRequest } from '$lib/storage/transfer-types.js';

function setup(store: MemoryStore, sourceBucket = 'b', destBucket = sourceBucket) {
  const source = memoryProvider(store, sourceBucket);
  const dest = sourceBucket === destBucket ? source : memoryProvider(store, destBucket);
  const events: TransferEvent[] = [];
  const controller = new AbortController();
  const logger = createMockLogger();
  const ctx: TransferContext = {
    source,
    dest,
    concurrency: 1,
    signal: controller.signal,
    logger,
    emit: (event) => events.push(event)
  };
  const run = (
    op: TransferRequest['op'],
    items: Array<string | TransferItemRequest>,
    destPrefix = 'dest/'
  ) =>
    executeTransfer(
      {
        op,
        sourceBucket,
        destBucket,
        destPrefix,
        items: items.map((item) => (typeof item === 'string' ? { sourceKey: item } : item))
      },
      ctx
    );
  return { source, dest, events, controller, logger, ctx, run };
}

/** Track how many copies run at once; each one waits a tick so they overlap. */
function trackPeak(provider: ReturnType<typeof setup>['source']) {
  const stats = { running: 0, peak: 0 };
  const copy = provider.copyObject.getMockImplementation()!;
  provider.copyObject.mockImplementation(async (...args) => {
    stats.peak = Math.max(stats.peak, ++stats.running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    stats.running--;
    return copy(...args);
  });
  return stats;
}

describe('executeTransfer', () => {
  it('copies a folder with its marker and reports one result per selected item', async () => {
    const store = memoryStore({ b: { 'docs/': 0, 'docs/a.txt': 3, 'docs/n/b.txt': 4 } });
    const { events, run } = setup(store);

    const { items, summary } = await run('copy', ['docs/']);

    expect(keysOf(store, 'b')).toEqual([
      'dest/docs/',
      'dest/docs/a.txt',
      'dest/docs/n/b.txt',
      'docs/',
      'docs/a.txt',
      'docs/n/b.txt'
    ]);
    expect(events[0]).toEqual({
      type: 'item-start',
      sourceKey: 'docs/',
      destRoot: 'dest/docs/',
      totalObjects: 3,
      totalBytes: 7
    });
    expect(items).toEqual([
      {
        sourceKey: 'docs/',
        destRoot: 'dest/docs/',
        status: 'done',
        copied: 3,
        failed: [],
        deletedOriginals: 0
      }
    ]);
    expect(summary).toEqual({ done: 1, partial: 0, failed: 0, refused: 0, cancelled: 0 });
    expect(events.at(-1)).toEqual({ type: 'complete', summary });
  });

  it('copies between buckets server-side through the destination provider', async () => {
    const store = memoryStore({ src: ['a.txt'], dst: [] });
    const { source, dest, run } = setup(store, 'src', 'dst');

    await run('move', ['a.txt'], '');

    expect(dest.copyObject).toHaveBeenCalledWith(
      'a.txt',
      'a.txt',
      expect.objectContaining({ sourceBucket: 'src' })
    );
    expect(keysOf(store, 'dst')).toEqual(['a.txt']);
    expect(source.deleteObjects).toHaveBeenCalledWith(['a.txt'], false);
    expect(keysOf(store, 'src')).toEqual([]);
  });

  it('merges folders: matching keys are overwritten, destination-only objects kept', async () => {
    const store = memoryStore({
      b: { 'docs/a.txt': 5, 'dest/docs/a.txt': 1, 'dest/docs/only-here.txt': 1 }
    });
    const { source, run } = setup(store);

    const { items } = await run('copy', [{ sourceKey: 'docs/', policy: 'merge' }]);

    expect(items[0].status).toBe('done');
    expect(store.get('b')!.get('dest/docs/a.txt')).toBe(5);
    expect(keysOf(store, 'b')).toContain('dest/docs/only-here.txt');
    expect(source.deleteObjects).not.toHaveBeenCalled();
  });

  it('replaces a file without deleting the destination first', async () => {
    const store = memoryStore({ b: { 'a.txt': 5, 'dest/a.txt': 1 } });
    const { source, run } = setup(store);

    const { items } = await run('copy', [{ sourceKey: 'a.txt', policy: 'replace' }]);

    expect(items[0].status).toBe('done');
    expect(store.get('b')!.get('dest/a.txt')).toBe(5);
    expect(source.deleteObjects).not.toHaveBeenCalled();
  });

  it('returns the numbered name of a keepBoth item', async () => {
    const store = memoryStore({ b: ['a.txt', 'dest/a.txt'] });
    const { run } = setup(store);

    const { items } = await run('copy', [{ sourceKey: 'a.txt', policy: 'keepBoth' }]);

    expect(items[0]).toMatchObject({ status: 'done', destRoot: 'dest/a (1).txt' });
  });

  it('deletes exactly the copied keys, so an object added mid-move survives', async () => {
    const store = memoryStore({ b: ['docs/', 'docs/a.txt'] });
    const { source, run } = setup(store);
    source.copyObject.mockImplementationOnce(async (from, to) => {
      store.get('b')!.set(to, 1);
      store.get('b')!.set('docs/late.txt', 1);
    });

    const { items } = await run('move', ['docs/']);

    expect(source.deleteObjects).toHaveBeenCalledWith(['docs/', 'docs/a.txt'], false);
    expect(items[0]).toMatchObject({ status: 'done', copied: 2, deletedOriginals: 2 });
    expect(keysOf(store, 'b')).toEqual(['dest/docs/', 'dest/docs/a.txt', 'docs/late.txt']);
  });

  it('keeps every original of a partially copied move', async () => {
    const store = memoryStore({ b: ['docs/a.txt', 'docs/b.txt'] });
    const { source, logger, run } = setup(store);
    source.copyObject.mockImplementationOnce(async () => {
      throw error(403, 'Access denied to "docs/a.txt"');
    });

    const { items } = await run('move', ['docs/']);

    expect(items[0]).toMatchObject({
      status: 'partial',
      copied: 1,
      failed: [{ key: 'docs/a.txt', error: 'Access denied to "docs/a.txt"' }],
      deletedOriginals: 0
    });
    expect(source.deleteObjects).not.toHaveBeenCalled();
    expect(keysOf(store, 'b')).toEqual(['dest/docs/b.txt', 'docs/a.txt', 'docs/b.txt']);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ source_key: 'docs/a.txt' }),
      'transfer object copy failed'
    );
  });

  it('reports an item where nothing was copied as failed', async () => {
    const store = memoryStore({ b: ['a.txt'] });
    const { source, run } = setup(store);
    source.copyObject.mockRejectedValueOnce(new Error('boom'));

    const { items } = await run('copy', ['a.txt', 'missing.txt']);

    expect(items.map((item) => item.status)).toEqual(['failed', 'failed']);
    expect(items[1].failed).toEqual([
      { key: 'missing.txt', error: 'Object "missing.txt" not found' }
    ]);
  });

  it('reports failed deletes of a move as partial', async () => {
    const store = memoryStore({ b: ['a.txt'] });
    const { source, run } = setup(store);
    source.deleteObjects.mockResolvedValueOnce({
      failed: [{ key: 'a.txt', message: 'Access denied' }]
    });

    const { items } = await run('move', ['a.txt']);

    expect(items[0]).toMatchObject({
      status: 'partial',
      copied: 1,
      deletedOriginals: 0,
      failed: [{ key: 'a.txt', error: 'Access denied' }]
    });
  });

  it('counts the originals really deleted when a delete call fails midway', async () => {
    const store = memoryStore({ b: ['docs/a', 'docs/b', 'docs/c'] });
    const { source, run } = setup(store);
    source.deleteObjects.mockImplementationOnce(async (keys) => {
      store.get('b')!.delete(keys[0]);
      throw new Error('connection reset');
    });

    const { items } = await run('move', ['docs/']);

    expect(items[0]).toMatchObject({
      status: 'partial',
      copied: 3,
      deletedOriginals: 1,
      failed: [{ key: 'docs/', error: 'connection reset' }]
    });
  });

  it('refuses a folder whose children would exceed the key limit, copying nothing', async () => {
    const child = `${'x'.repeat(1015)}.txt`;
    const store = memoryStore({ b: ['docs/', `docs/${child}`] });
    const { source, run } = setup(store);

    const { items } = await run('copy', ['docs/'], 'longer-destination/');

    expect(items[0]).toMatchObject({ status: 'refused', reason: 'name_too_long', copied: 0 });
    expect(source.copyObject).not.toHaveBeenCalled();
  });

  it('reports refused items without touching storage', async () => {
    const store = memoryStore({ b: ['a.txt', 'dest/a.txt'] });
    const { source, events, run } = setup(store);

    const { items } = await run('move', ['a.txt']);

    expect(items).toEqual([
      {
        sourceKey: 'a.txt',
        status: 'refused',
        reason: 'conflict',
        copied: 0,
        failed: [],
        deletedOriginals: 0
      }
    ]);
    expect(source.copyObject).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual(['item-done', 'complete']);
  });

  it('never merges a folder into an ancestor that contains it, so no source is lost', async () => {
    const store = memoryStore({ b: { 'y/y/f': 1, 'y/y/y/f': 2 } });
    const { source, run } = setup(store);

    const { items } = await run('move', [{ sourceKey: 'y/y/', policy: 'merge' }], '');

    expect(items[0]).toMatchObject({ status: 'refused', reason: 'overlaps_source' });
    expect(source.copyObject).not.toHaveBeenCalled();
    expect(Object.fromEntries(store.get('b')!)).toEqual({ 'y/y/f': 1, 'y/y/y/f': 2 });
  });

  it('renames a folder within its parent', async () => {
    const store = memoryStore({ b: ['a/old/', 'a/old/x.txt'] });
    const { run } = setup(store);

    const { items } = await run('rename', [{ sourceKey: 'a/old/', name: 'new' }], '');

    expect(items[0]).toMatchObject({ status: 'done', destRoot: 'a/new/' });
    expect(keysOf(store, 'b')).toEqual(['a/new/', 'a/new/x.txt']);
  });

  describe('cancellation', () => {
    it('finishes the deletes of a running item and cancels the next one', async () => {
      const store = memoryStore({ b: ['one/a.txt', 'one/b.txt', 'two.txt'] });
      const { source, controller, run } = setup(store);
      const deleteObjects = source.deleteObjects.getMockImplementation()!;
      source.deleteObjects.mockImplementationOnce(async (keys, expand) => {
        controller.abort();
        return deleteObjects(keys, expand);
      });

      const { items } = await run('move', ['one/', 'two.txt']);

      expect(items[0]).toMatchObject({ status: 'done', deletedOriginals: 2 });
      expect(items[1]).toMatchObject({ status: 'cancelled', copied: 0 });
      expect(keysOf(store, 'b')).toEqual(['dest/one/a.txt', 'dest/one/b.txt', 'two.txt']);
    });

    it('keeps all originals of a move cancelled while copying', async () => {
      const store = memoryStore({ b: ['one/a.txt', 'one/b.txt', 'one/c.txt', 'two.txt'] });
      const { source, controller, events, run } = setup(store);
      const copy = source.copyObject.getMockImplementation()!;
      source.copyObject.mockImplementationOnce(async (from, to, options) => {
        await copy(from, to, options);
        controller.abort();
      });

      const { items } = await run('move', ['one/', 'two.txt']);

      expect(items.map((item) => item.status)).toEqual(['cancelled', 'cancelled']);
      expect(items[0]).toMatchObject({ copied: 1, failed: [] });
      expect(source.deleteObjects).not.toHaveBeenCalled();
      expect(keysOf(store, 'b')).toEqual([
        'dest/one/a.txt',
        'one/a.txt',
        'one/b.txt',
        'one/c.txt',
        'two.txt'
      ]);
      expect(events.at(-1)).toMatchObject({ type: 'complete' });
    });

    it('treats a copy aborted mid-flight as interrupted, not failed', async () => {
      const store = memoryStore({ b: ['a.txt'] });
      const { source, controller, run } = setup(store);
      source.copyObject.mockImplementationOnce(async () => {
        controller.abort();
        throw error(502, 'aborted');
      });

      const { items } = await run('copy', ['a.txt']);

      expect(items[0]).toMatchObject({ status: 'cancelled', copied: 0, failed: [] });
    });
  });

  it('always ends with complete, even when an existence check fails', async () => {
    const store = memoryStore({ b: ['a.txt'] });
    const { source, events, run } = setup(store);
    source.exists.mockImplementationOnce(async () => {
      throw error(403, 'Access denied');
    });

    const { items } = await run('copy', ['a.txt']);

    expect(items[0]).toMatchObject({
      status: 'failed',
      failed: [{ key: 'a.txt', error: 'Access denied' }]
    });
    expect(events.map((event) => event.type)).toEqual(['item-done', 'complete']);
  });

  it('copies objects of one item through the concurrency pool', async () => {
    const keys = Array.from({ length: 6 }, (_, i) => `docs/${i}`);
    const store = memoryStore({ b: keys });
    const { source } = setup(store);
    let running = 0;
    let peak = 0;
    const copy = source.copyObject.getMockImplementation()!;
    source.copyObject.mockImplementation(async (...args) => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running--;
      return copy(...args);
    });

    await executeTransfer(
      {
        op: 'copy',
        sourceBucket: 'b',
        destBucket: 'b',
        destPrefix: 'dest/',
        items: [{ sourceKey: 'docs/' }]
      },
      {
        source,
        dest: source,
        concurrency: 3,
        signal: new AbortController().signal,
        logger: createMockLogger(),
        emit: vi.fn()
      }
    );

    expect(peak).toBe(3);
  });

  describe('concurrent items', () => {
    it('runs single-file items through the concurrency pool', async () => {
      const keys = Array.from({ length: 6 }, (_, i) => `f${i}.txt`);
      const { source, ctx, run } = setup(memoryStore({ b: keys }));
      ctx.concurrency = 3;
      const stats = trackPeak(source);

      const { summary } = await run('copy', keys);

      expect(stats.peak).toBe(3);
      expect(summary.done).toBe(6);
    });

    it('shares one copy budget between items', async () => {
      const keys = ['a/', 'b/'].flatMap((folder) =>
        Array.from({ length: 4 }, (_, i) => `${folder}${i}`)
      );
      const { source, ctx, run } = setup(memoryStore({ b: keys }));
      ctx.concurrency = 3;
      const stats = trackPeak(source);

      const { summary } = await run('copy', ['a/', 'b/']);

      expect(stats.peak).toBe(3);
      expect(summary.done).toBe(2);
    });

    it('returns results in request order when a later item finishes first', async () => {
      const { source, ctx, events, run } = setup(memoryStore({ b: ['slow.txt', 'fast.txt'] }));
      ctx.concurrency = 2;
      const copy = source.copyObject.getMockImplementation()!;
      source.copyObject.mockImplementation(async (from, to, options) => {
        if (from === 'slow.txt') await new Promise((resolve) => setTimeout(resolve, 5));
        return copy(from, to, options);
      });

      const { items } = await run('copy', ['slow.txt', 'fast.txt']);

      expect(items.map((item) => item.sourceKey)).toEqual(['slow.txt', 'fast.txt']);
      const done = events.filter((event) => event.type === 'item-done');
      expect(done.map((event) => event.sourceKey)).toEqual(['fast.txt', 'slow.txt']);
    });

    it('gives every item a result when cancelled while items run in parallel', async () => {
      const keys = Array.from({ length: 5 }, (_, i) => `f${i}.txt`);
      const store = memoryStore({ b: keys });
      const { source, ctx, controller, events, run } = setup(store);
      ctx.concurrency = 2;
      const copy = source.copyObject.getMockImplementation()!;
      source.copyObject.mockImplementationOnce(async (from, to, options) => {
        await copy(from, to, options);
        controller.abort();
      });

      const { items, summary } = await run('move', keys);

      expect(items).toHaveLength(5);
      expect(summary.cancelled + summary.done).toBe(5);
      // A cancelled item of a move keeps its original.
      const cancelled = items.filter((item) => item.status === 'cancelled');
      expect(cancelled.length).toBeGreaterThan(0);
      for (const item of cancelled) {
        expect(item.deletedOriginals).toBe(0);
        expect(keysOf(store, 'b')).toContain(item.sourceKey);
      }
      expect(events.filter((event) => event.type === 'item-done')).toHaveLength(5);
      expect(events.at(-1)).toMatchObject({ type: 'complete' });
    });

    it('passes the known size to the copy, so the provider can skip reading the source', async () => {
      const { source, run } = setup(memoryStore({ b: ['a.txt', 'docs/b.txt'] }));

      await run('copy', ['a.txt', 'docs/']);

      for (const [, , options] of source.copyObject.mock.calls) {
        expect(options?.size).toEqual(expect.any(Number));
      }
      expect(source.copyObject).toHaveBeenCalledTimes(2);
    });
  });
});
