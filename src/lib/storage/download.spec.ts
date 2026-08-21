import { describe, expect, it, vi } from 'vitest';
import { startDownload } from './download.js';
import { createMemoryStorageApi } from './api.test-utils.js';

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
