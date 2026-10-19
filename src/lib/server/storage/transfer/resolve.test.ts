import { describe, expect, it } from 'vitest';
import {
  isInside,
  resolveItems,
  toPlanItem,
  validateTransferRequest,
  type TransferRequest
} from './resolve.js';
import { memoryProvider, memoryStore } from './memory-provider.test-utils.js';
import type { TransferItemRequest } from '$lib/storage/transfer-types.js';

function request(
  op: TransferRequest['op'],
  items: Array<string | TransferItemRequest>,
  destPrefix = 'dest/',
  buckets: { sourceBucket?: string; destBucket?: string } = {}
): TransferRequest {
  return {
    op,
    sourceBucket: buckets.sourceBucket ?? 'b',
    destBucket: buckets.destBucket ?? buckets.sourceBucket ?? 'b',
    destPrefix,
    items: items.map((item) => (typeof item === 'string' ? { sourceKey: item } : item))
  };
}

async function plan(objects: string[], req: TransferRequest) {
  const dest = memoryProvider(memoryStore({ [req.destBucket]: objects }), req.destBucket);
  return (await resolveItems(req, dest, { mode: 'plan', concurrency: 4 })).map(toPlanItem);
}

async function resolve(objects: string[], req: TransferRequest) {
  const dest = memoryProvider(memoryStore({ [req.destBucket]: objects }), req.destBucket);
  return resolveItems(req, dest, { mode: 'execute', concurrency: 4 });
}

describe('isInside', () => {
  it('applies only to folders', () => {
    expect(isInside('a/b.txt', 'a/')).toBe(true);
    expect(isInside('a/', 'a/')).toBe(true);
    expect(isInside('ab/c', 'a')).toBe(false);
    expect(isInside('a/b', 'a')).toBe(false);
    expect(isInside('ab/', 'a/')).toBe(false);
  });
});

describe('validateTransferRequest', () => {
  it('accepts up to 1000 items and refuses more', () => {
    const keys = Array.from({ length: 1001 }, (_, i) => `f${i}`);
    expect(() => validateTransferRequest(request('copy', keys.slice(0, 1000)))).not.toThrow();
    expect(() => validateTransferRequest(request('copy', keys))).toThrow('At most 1000');
  });

  it('refuses empty, duplicate and overlapping sources', () => {
    expect(() => validateTransferRequest(request('copy', []))).toThrow();
    expect(() => validateTransferRequest(request('copy', ['a', 'a']))).toThrow('Duplicate');
    expect(() => validateTransferRequest(request('copy', ['a/', 'a/b.txt']))).toThrow(
      'Overlapping'
    );
    expect(() => validateTransferRequest(request('copy', ['a', 'a/']))).not.toThrow();
  });

  it('keeps a rename in its bucket', () => {
    const req = request('rename', [{ sourceKey: 'a', name: 'b' }], '', {
      sourceBucket: 'x',
      destBucket: 'y'
    });
    expect(() => validateTransferRequest(req)).toThrow('bucket');
  });
});

describe('folder existence', () => {
  it.each([
    ['marker only', ['dest/docs/']],
    ['marker and children', ['dest/docs/', 'dest/docs/a.txt']],
    ['children only', ['dest/docs/nested/a.txt']]
  ])('reports a folder conflict for %s', async (_, objects) => {
    const [item] = await plan(objects, request('copy', ['src/docs/']));
    expect(item.conflict).toBe('folder');
  });

  it('never lets a file and a folder of the same name conflict', async () => {
    const items = await plan(['dest/docs', 'dest/a/'], request('copy', ['src/docs/', 'src/a']));
    expect(items.map((item) => item.conflict)).toEqual(['none', 'none']);
  });
});

describe('plan', () => {
  it('marks a copy onto itself and suggests the first free numbered name', async () => {
    const [item] = await plan(['dest/a.txt', 'dest/a (1).txt'], request('copy', ['dest/a.txt']));
    expect(item).toEqual({
      sourceKey: 'dest/a.txt',
      kind: 'file',
      destKey: 'dest/a.txt',
      conflict: 'file',
      selfConflict: true,
      suggestedName: 'a (2).txt'
    });
  });

  it('lets earlier items count when suggesting names', async () => {
    const items = await plan(['dest/a.txt'], request('copy', ['dest/a.txt', 'other/a.txt']));
    expect(items[0].suggestedName).toBe('a (1).txt');
    expect(items[1]).toMatchObject({ conflict: 'file', suggestedName: 'a (2).txt' });
  });

  it('does not refuse an item whose name another item only got suggested', async () => {
    const items = await plan(['dest/a.txt'], request('copy', ['p/a.txt', 'q/a (1).txt']));
    expect(items[1]).toMatchObject({ conflict: 'none' });
    expect(items[1].refused).toBeUndefined();
  });

  it('refuses a second item with the same destination', async () => {
    const items = await plan([], request('copy', ['p/docs/', 'q/docs/']));
    expect(items[0].refused).toBeUndefined();
    expect(items[1].refused).toBe('duplicate_destination');
  });
});

describe('refusals', () => {
  it('refuses a move to where the item already is', async () => {
    const [item] = await resolve(['dest/a.txt'], request('move', ['dest/a.txt']));
    expect(item.refused).toBe('same_location');
  });

  it('refuses a copy onto itself without keepBoth or rename', async () => {
    const [plain] = await resolve(['dest/a.txt'], request('copy', ['dest/a.txt']));
    const [replace] = await resolve(
      ['dest/a.txt'],
      request('copy', [{ sourceKey: 'dest/a.txt', policy: 'replace' }])
    );
    const [keepBoth] = await resolve(
      ['dest/a.txt'],
      request('copy', [{ sourceKey: 'dest/a.txt', policy: 'keepBoth' }])
    );
    expect(plain.refused).toBe('same_location');
    expect(replace.refused).toBe('same_location');
    expect(keepBoth.refused).toBeUndefined();
    expect(keepBoth.destKey).toBe('dest/a (1).txt');
  });

  it('refuses a folder into its own subtree', async () => {
    const items = await resolve(['a/'], request('move', ['a/'], 'a/b/'));
    expect(items[0].refused).toBe('into_itself');
  });

  it('only checks into_itself within one bucket', async () => {
    const req = request('copy', ['a/'], 'a/b/', { sourceBucket: 'x', destBucket: 'y' });
    const [item] = await resolve([], req);
    expect(item.refused).toBeUndefined();
  });

  it('refuses a destination that equals, contains or is inside another source', async () => {
    const equals = await resolve([], request('copy', ['x/a.txt', 'dest/a.txt'], 'dest/'));
    expect(equals[0].refused).toBe('overlaps_source');
    const contains = await resolve([], request('move', ['x/sub/', 'dest/sub/a.txt'], 'dest/'));
    expect(contains[0].refused).toBe('overlaps_source');
    const inside = await resolve([], request('copy', ['a.txt', 'dest/'], 'dest/'));
    expect(inside.map((item) => item.refused)).toEqual(['overlaps_source', 'into_itself']);
  });

  it('refuses a folder into an ancestor that contains it, whatever the policy', async () => {
    const objects = ['y/y/f', 'y/y/y/f'];
    for (const op of ['move', 'copy'] as const) {
      const [merge] = await resolve(
        objects,
        request(op, [{ sourceKey: 'y/y/', policy: 'merge' }], '')
      );
      expect(merge).toMatchObject({ destKey: 'y/', refused: 'overlaps_source' });
    }
    const [planned] = await plan(objects, request('move', ['y/y/'], ''));
    expect(planned.refused).toBe('overlaps_source');
  });

  it('allows a keepBoth copy next to the ancestor, which no longer contains the source', async () => {
    const [item] = await resolve(
      ['y/y/f'],
      request('copy', [{ sourceKey: 'y/y/', policy: 'keepBoth' }], '')
    );
    expect(item.refused).toBeUndefined();
    expect(item.destKey).toBe('y (1)/');
  });

  it('allows moving a folder up when the destination does not contain it', async () => {
    const [item] = await resolve(['a/b/f'], request('move', ['a/b/'], ''));
    expect(item).toMatchObject({ destKey: 'b/', conflict: 'none' });
    expect(item.refused).toBeUndefined();
  });

  it('refuses a conflict that appeared after the plan', async () => {
    const [item] = await resolve(['dest/a.txt'], request('copy', ['src/a.txt']));
    expect(item.refused).toBe('conflict');
  });

  it('applies replace to files and merge to folders only', async () => {
    const items = await resolve(
      ['dest/a.txt', 'dest/docs/x'],
      request('copy', [
        { sourceKey: 'src/a.txt', policy: 'replace' },
        { sourceKey: 'src/docs/', policy: 'merge' },
        { sourceKey: 'src/b.txt', policy: 'merge' },
        { sourceKey: 'src/more/', policy: 'replace' }
      ])
    );
    expect(items.map((item) => item.refused)).toEqual([
      undefined,
      undefined,
      'policy_mismatch',
      'policy_mismatch'
    ]);
  });

  it('refuses invalid rename names', async () => {
    const items = await resolve(
      [],
      request('copy', [
        { sourceKey: 'src/a.txt', policy: 'rename', name: 'x/y' },
        { sourceKey: 'src/b.txt', policy: 'rename' },
        { sourceKey: 'src/c.txt', policy: 'rename', name: '..' }
      ])
    );
    expect(items.map((item) => item.refused)).toEqual([
      'invalid_name',
      'invalid_name',
      'invalid_name'
    ]);
  });

  it('never lets a rename overwrite', async () => {
    const [item] = await resolve(
      ['a/b.txt', 'a/c.txt'],
      request('rename', [{ sourceKey: 'a/b.txt', name: 'c.txt' }])
    );
    expect(item).toMatchObject({ destKey: 'a/c.txt', refused: 'conflict' });
  });

  it('renames within the parent, keeping empty path segments', async () => {
    const [item] = await resolve(
      ['a/c.txt', 'a//b.txt'],
      request('rename', [{ sourceKey: 'a//b.txt', name: 'c.txt' }])
    );
    expect(item.refused).toBeUndefined();
    expect(item.destKey).toBe('a//c.txt');
  });

  it('refuses keys over 1024 bytes, including numbered names', async () => {
    const long = 'x'.repeat(1020);
    const [tooLong] = await resolve([], request('copy', [`src/${long}.txt`]));
    expect(tooLong.refused).toBe('name_too_long');
    const fits = `${'y'.repeat(1015)}.txt`;
    const [numbered] = await resolve(
      [`dest/${fits}`],
      request('copy', [{ sourceKey: `src/${fits}`, policy: 'keepBoth' }])
    );
    expect(numbered.refused).toBe('name_too_long');
  });
});

describe('keepBoth', () => {
  it('skips names taken earlier in the same request', async () => {
    const items = await resolve(
      ['dest/a.txt'],
      request('copy', [
        { sourceKey: 'p/a.txt', policy: 'keepBoth' },
        { sourceKey: 'q/a.txt', policy: 'keepBoth' }
      ])
    );
    expect(items.map((item) => item.destKey)).toEqual(['dest/a (1).txt', 'dest/a (2).txt']);
  });

  it('numbers an item whose name an earlier item took', async () => {
    const items = await resolve(
      [],
      request('copy', ['p/a.txt', { sourceKey: 'q/a.txt', policy: 'keepBoth' }])
    );
    expect(items.map((item) => item.destKey)).toEqual(['dest/a.txt', 'dest/a (1).txt']);
  });

  it('numbers folders at the end of the name', async () => {
    const [item] = await resolve(
      ['dest/v1.2/x'],
      request('copy', [{ sourceKey: 'src/v1.2/', policy: 'keepBoth' }])
    );
    expect(item.destKey).toBe('dest/v1.2 (1)/');
  });
});
