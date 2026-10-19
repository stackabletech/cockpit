import { describe, expect, it } from 'vitest';
import type { TreemapNode } from '$lib/storage/details-types.js';
import {
  DEPTH_LIST_MAX_ENTRIES,
  DirectorySizeAggregator,
  TREEMAP_MAX_LEAVES
} from './directory-tree.js';

const PREFIX = 'data/';

function leaves(node: TreemapNode): TreemapNode[] {
  return node.children?.length ? node.children.flatMap(leaves) : [node];
}

describe('DirectorySizeAggregator', () => {
  it('sums totals, depth lists and the tree across batches', () => {
    const agg = new DirectorySizeAggregator(PREFIX, 100);
    const t1 = new Date('2026-01-01T00:00:00Z');
    const t2 = new Date('2026-02-01T00:00:00Z');
    expect(
      agg.add([
        { key: 'data/', size: 0 },
        { key: 'data/a.txt', size: 10, lastModified: t1 }
      ])
    ).toBe(true);
    agg.add([
      { key: 'data/sub/', size: 0 },
      { key: 'data/sub/b.txt', size: 5, lastModified: t2 },
      { key: 'data/sub/deep/c.txt', size: 7, lastModified: t1 }
    ]);

    const result = agg.result(42);
    expect(result).toMatchObject({
      totalSize: 22,
      totalKeys: 5,
      totalFiles: 3,
      totalDirectories: 2,
      maxDepth: 3,
      durationMs: 42,
      truncated: false
    });
    expect(result.childrenByDepth[1].items).toEqual([
      { name: 'sub/', size: 12, lastModified: t2.toISOString(), isDirectory: true },
      { name: 'a.txt', size: 10, lastModified: t1.toISOString(), isDirectory: false }
    ]);
    expect(result.childrenByDepth[3].items.map((i) => i.name)).toEqual(['sub/deep/c.txt']);
    expect(result.tree.name).toBe('data');
    expect(result.tree.size).toBe(22);
    expect(leaves(result.tree).map((l) => l.fullKey)).toEqual([
      'data/sub/deep/c.txt',
      'data/sub/b.txt',
      'data/a.txt'
    ]);
  });

  it('keeps a file and a folder of the same name apart', () => {
    const agg = new DirectorySizeAggregator(PREFIX, 100);
    agg.add([
      { key: 'data/x', size: 1 },
      { key: 'data/x/y', size: 2 }
    ]);
    const { childrenByDepth, tree } = agg.result(0);
    expect(childrenByDepth[1].items.map((i) => [i.name, i.size, i.isDirectory])).toEqual([
      ['x/', 2, true],
      ['x', 1, false]
    ]);
    expect(leaves(tree).map((l) => l.fullKey)).toEqual(['data/x/y', 'data/x']);
  });

  it('gives an empty folder marker its key with the trailing slash', () => {
    const agg = new DirectorySizeAggregator(PREFIX, 100);
    agg.add([{ key: 'data/empty/', size: 0 }]);
    expect(leaves(agg.result(0).tree)).toEqual([
      { name: 'empty', size: 0, path: undefined, fullKey: 'data/empty/' }
    ]);
  });

  it('stops at the key limit and marks the result as truncated', () => {
    const agg = new DirectorySizeAggregator(PREFIX, 3);
    const batch = Array.from({ length: 5 }, (_, i) => ({ key: `data/f${i}`, size: 1 }));
    expect(agg.add(batch)).toBe(false);
    expect(agg.add([{ key: 'data/later', size: 1 }])).toBe(false);
    const result = agg.result(0);
    expect(result.totalKeys).toBe(3);
    expect(result.totalSize).toBe(3);
    expect(result.truncated).toBe(true);
  });

  it('handles very deep and very wide listings without a spread', () => {
    const agg = new DirectorySizeAggregator(PREFIX, 300_000);
    const keys = Array.from({ length: 200_000 }, (_, i) => ({ key: `data/f${i}`, size: i }));
    agg.add(keys);
    agg.add([{ key: 'data/' + 'd/'.repeat(300) + 'leaf', size: 1 }]);
    const result = agg.result(0);
    expect(result.maxDepth).toBe(301);
    expect(result.totalKeys).toBe(200_001);
  });

  it('prunes the treemap to the largest files and groups the rest', () => {
    const agg = new DirectorySizeAggregator(PREFIX, 10_000);
    // Many small files in folders without any large file, plus large files at the top.
    for (let d = 0; d < 50; d++) {
      agg.add(Array.from({ length: 20 }, (_, i) => ({ key: `data/d${d}/s${i}`, size: 1 })));
    }
    agg.add(
      Array.from({ length: TREEMAP_MAX_LEAVES }, (_, i) => ({ key: `data/big${i}`, size: 1000 }))
    );

    const { tree } = agg.result(0);
    const all = leaves(tree);
    const real = all.filter((l) => l.moreCount === undefined);
    const more = all.filter((l) => l.moreCount !== undefined);
    expect(real).toHaveLength(TREEMAP_MAX_LEAVES);
    expect(real.every((l) => l.size === 1000)).toBe(true);
    // All 50 small folders collapse into a single node at the top level.
    expect(more).toEqual([{ name: '', size: 1000, moreCount: 1000 }]);
    expect(tree.children!.reduce((sum, c) => sum + c.size, 0)).toBe(tree.size);
  });

  it('caps each depth list and reports what was left out', () => {
    const agg = new DirectorySizeAggregator(PREFIX, 10_000);
    const extra = 5;
    agg.add(
      Array.from({ length: DEPTH_LIST_MAX_ENTRIES + extra }, (_, i) => ({
        key: `data/f${i}`,
        size: i + 1
      }))
    );
    const list = agg.result(0).childrenByDepth[1];
    expect(list.items).toHaveLength(DEPTH_LIST_MAX_ENTRIES);
    expect(list.items[0].size).toBe(DEPTH_LIST_MAX_ENTRIES + extra);
    expect(list.omittedCount).toBe(extra);
    expect(list.omittedSize).toBe(1 + 2 + 3 + 4 + 5);
  });

  it('returns an empty result for an empty folder', () => {
    const result = new DirectorySizeAggregator(PREFIX, 10).result(0);
    expect(result).toMatchObject({ totalKeys: 0, maxDepth: 1, truncated: false });
    expect(result.tree).toEqual({ name: 'data', size: 0 });
    expect(result.childrenByDepth[1]).toEqual({ items: [], omittedCount: 0, omittedSize: 0 });
  });
});
