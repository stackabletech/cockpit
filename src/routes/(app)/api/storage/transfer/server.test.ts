import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  keysOf,
  memoryProvider,
  memoryStore,
  type MemoryStore
} from '$lib/server/storage/transfer/memory-provider.test-utils.js';

const { flags, state } = vi.hoisted(() => ({
  flags: { paste: true, move: true, rename: true },
  state: { store: null as unknown as MemoryStore }
}));
vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));
vi.mock('$lib/server/feature-flags.js', () => ({
  get storagePasteEnabled() {
    return flags.paste;
  },
  get storageMoveEnabled() {
    return flags.move;
  },
  get storageRenameEnabled() {
    return flags.rename;
  }
}));
vi.mock('$lib/server/storage/config.js', () => ({ storageTransferConcurrency: 2 }));
vi.mock('$lib/server/storage/request-context.js', () => ({
  createStorageProviderForBucket: (_event: unknown, bucket: string) =>
    memoryProvider(state.store, bucket)
}));

import { POST } from './+server.js';
import { DELETE as cancelJob, GET as readJob } from '../copy/job/[jobId]/+server.js';
import { createMockLogger } from '$lib/test-utils/mock-logger.js';

const user = { id: 'user-1' };

function event(body: unknown) {
  return {
    request: new Request('http://localhost/api/storage/transfer', {
      method: 'POST',
      body: JSON.stringify(body)
    }),
    locals: { logger: createMockLogger(), user }
  } as unknown as Parameters<typeof POST>[0];
}

function jobEvent(jobId: string) {
  return { params: { jobId }, locals: { user } } as unknown as Parameters<typeof readJob>[0];
}

async function lines(response: Response) {
  const text = await response.text();
  return text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}

function copy(keys: string[], extra: Record<string, unknown> = {}) {
  return {
    op: 'copy',
    jobId: randomUUID(),
    source: { bucket: 'b' },
    dest: { bucket: 'b', prefix: 'dest/' },
    items: keys.map((sourceKey) => ({ sourceKey })),
    ...extra
  };
}

describe('POST /api/storage/transfer', () => {
  beforeEach(() => {
    Object.assign(flags, { paste: true, move: true, rename: true });
    state.store = memoryStore({ b: ['a.txt', 'docs/x.txt'], other: [] });
  });

  it('streams NDJSON that always ends with complete', async () => {
    const response = await POST(event(copy(['a.txt', 'docs/'])));

    expect(response.headers.get('Content-Type')).toBe('application/x-ndjson');
    const events = await lines(response);
    // Items run concurrently, so only each item's own events are ordered.
    for (const key of ['a.txt', 'docs/']) {
      const own = events.filter((e) => e.sourceKey === key && e.type !== 'progress');
      expect(own.map((e) => e.type)).toEqual(['item-start', 'item-done']);
    }
    expect(events.filter((e) => e.type === 'complete')).toHaveLength(1);
    expect(events.at(-1).summary).toEqual({
      done: 2,
      partial: 0,
      failed: 0,
      refused: 0,
      cancelled: 0
    });
    expect(keysOf(state.store, 'b')).toContain('dest/docs/x.txt');
  });

  it('records every item result in the job', async () => {
    const body = copy(['a.txt', 'missing/']);
    await lines(await POST(event(body)));

    const job = await (await readJob(jobEvent(body.jobId))).json();
    expect(job).toMatchObject({ status: 'done', result: { summary: { done: 1, failed: 1 } } });
    // Recorded as items finish, which need not be request order.
    expect(job.items.map((item: { sourceKey: string }) => item.sourceKey).sort()).toEqual([
      'a.txt',
      'missing/'
    ]);
  });

  it('moves between buckets', async () => {
    const body = { ...copy(['a.txt']), op: 'move', dest: { bucket: 'other', prefix: '' } };
    await lines(await POST(event(body)));

    expect(keysOf(state.store, 'other')).toEqual(['a.txt']);
    expect(keysOf(state.store, 'b')).toEqual(['docs/x.txt']);
  });

  it.each([
    ['an invalid body', { op: 'copy' }],
    ['a missing job ID', { ...copy(['a.txt']), jobId: undefined }],
    ['a copy without destination', { ...copy(['a.txt']), dest: undefined }],
    ['a rename with destination', { ...copy(['a.txt']), op: 'rename' }],
    [
      'a rename with a policy',
      {
        ...copy([]),
        op: 'rename',
        dest: undefined,
        items: [{ sourceKey: 'a.txt', name: 'b.txt', policy: 'replace' }]
      }
    ],
    ['more than 1000 items', copy(Array.from({ length: 1001 }, (_, i) => `f${i}`))],
    ['duplicate sources', copy(['a.txt', 'a.txt'])],
    [
      'a destination prefix that is not a folder',
      { ...copy(['a.txt']), dest: { bucket: 'b', prefix: 'archive' } }
    ],
    ['overlapping sources', copy(['docs/', 'docs/x.txt'])]
  ])('answers 400 for %s', async (_, body) => {
    await expect(POST(event(body))).rejects.toMatchObject({ status: 400 });
  });

  it('answers 409 when a job ID is used again', async () => {
    const body = copy(['a.txt']);
    await lines(await POST(event(body)));
    await expect(POST(event(body))).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['copy', { paste: false, move: true, rename: true }],
    ['move', { paste: false, move: false, rename: true }],
    ['rename', { paste: true, move: true, rename: false }]
  ])('answers 404 for %s when its flag is off', async (op, flagState) => {
    Object.assign(flags, flagState);
    const body =
      op === 'rename'
        ? { ...copy([]), op, dest: undefined, items: [{ sourceKey: 'a.txt', name: 'b.txt' }] }
        : { ...copy(['a.txt']), op };
    await expect(POST(event(body))).rejects.toMatchObject({ status: 404 });
  });

  it('allows a move with only the paste flag', async () => {
    Object.assign(flags, { paste: true, move: false, rename: false });
    const response = await POST(event({ ...copy(['a.txt']), op: 'move' }));
    expect((await lines(response)).at(-1).type).toBe('complete');
  });

  it('keeps every original when a running move is cancelled', async () => {
    state.store = memoryStore({ b: Array.from({ length: 20 }, (_, i) => `many/${i}.txt`) });
    const body = { ...copy(['many/']), op: 'move' };
    const response = await POST(event(body));

    expect((await cancelJob(jobEvent(body.jobId))).status).toBe(200);
    const events = await lines(response);

    expect(events.find((e) => e.type === 'item-done')).toMatchObject({
      status: 'cancelled',
      deletedOriginals: 0
    });
    expect(keysOf(state.store, 'b').filter((key) => key.startsWith('many/'))).toHaveLength(20);
    const job = await (await readJob(jobEvent(body.jobId))).json();
    expect(job).toMatchObject({ status: 'cancelled', cancelRequested: true });
  });
});
