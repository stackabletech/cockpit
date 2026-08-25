import { describe, expect, it, vi } from 'vitest';
import { estimateArchiveSize, startDownload } from './download.js';
import { createMemoryStorageApi } from './api.test-utils.js';

describe('estimateArchiveSize', () => {
  it('returns the end-of-central-directory size for no entries', () => {
    expect(estimateArchiveSize([])).toBe(22);
  });

  it('adds per-entry structure overhead to the payload total', () => {
    // Each entry contributes 92 bytes of fixed structure plus its name stored
    // twice ('a.txt'/'b.txt' = 5 characters each), on top of the 22-byte EOCD
    // and the payload itself.
    const estimate = estimateArchiveSize([
      { key: 'a.txt', size: 5, isDirectory: false },
      { key: 'b.txt', size: 10, isDirectory: false }
    ]);
    expect(estimate).toBe(22 + 2 * (92 + 2 * 5) + 15);
  });

  it('appends a slash to directory entry names without one', () => {
    const withSlash = estimateArchiveSize([{ key: 'dir/', size: 0, isDirectory: true }]);
    const withoutSlash = estimateArchiveSize([{ key: 'dir', size: 0, isDirectory: true }]);
    expect(withoutSlash).toBe(withSlash);
    expect(withSlash).toBe(22 + 92 + 2 * 4);
  });

  it('scales with many entries so large downloads show a meaningful size', () => {
    const entries = Array.from({ length: 1_000 }, (_, index) => ({
      key: `file-${index}.bin`,
      size: 1_000_000,
      isDirectory: false
    }));
    const estimate = estimateArchiveSize(entries);
    expect(estimate).toBeGreaterThan(1_000 * 1_000_000);
    expect(estimate).toBeLessThan(1_001 * 1_000_000);
  });
});

describe('startDownload', () => {
  it('starts every manifest stream without polling or local persistence', async () => {
    vi.useFakeTimers();
    const api = createMemoryStorageApi({
      createDownloadManifest: async () => ({
        id: 'manifest-1',
        expiresAt: new Date().toISOString(),
        files: [
          { filename: 'one.txt', size: 1, part: 1 },
          { filename: 'two.txt', size: 2, part: 2 }
        ]
      })
    });
    const click = vi.fn();
    vi.stubGlobal('document', {
      createElement: () => ({ click, style: {}, remove: vi.fn() }),
      body: { appendChild: vi.fn() }
    });

    const promise = startDownload(api, 'bucket', '', ['one.txt', 'two.txt']);
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toEqual({ id: 'manifest-1', fileCount: 2, totalBytes: 3 });
    expect(click).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
