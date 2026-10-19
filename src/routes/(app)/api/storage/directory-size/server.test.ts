import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DirectorySizeEvent } from '$lib/storage/details-types.js';
import type { ProgressiveListOptions } from '$lib/server/storage/provider.js';

type Batch = Array<{ key: string; size: number }>;
type OnBatch = (batch: Batch) => void | boolean;

const mockProvider = { listAllKeysProgressively: vi.fn() };
vi.mock('$lib/server/storage/request-context.js', () => ({
  createStorageProvider: () => ({ provider: mockProvider, bucket: 'b1' })
}));
vi.mock('$lib/server/storage/directory-tree.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/storage/directory-tree.js')>()),
  DIRECTORY_SIZE_MAX_KEYS: 3
}));

import { GET } from './+server.js';

function mockEvent(prefix: string, signal = new AbortController().signal) {
  const url = new URL('http://localhost/api/storage/directory-size');
  url.searchParams.set('prefix', prefix);
  return {
    url,
    request: new Request(url, { signal }),
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } }
  } as unknown as Parameters<typeof GET>[0];
}

async function readEvents(response: Response): Promise<DirectorySizeEvent[]> {
  const text = await response.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6)) as DirectorySizeEvent);
}

describe('GET /api/storage/directory-size', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when prefix is missing', async () => {
    await expect(GET(mockEvent(''))).rejects.toThrow(expect.objectContaining({ status: 400 }));
  });

  it('stops listing at the key limit and reports a truncated result', async () => {
    let calls = 0;
    mockProvider.listAllKeysProgressively.mockImplementation(
      async (_prefix: string, onBatch: OnBatch) => {
        for (let page = 0; page < 10; page++) {
          calls++;
          const batch = [0, 1].map((i) => ({ key: `p/${page}-${i}`, size: 1 }));
          if (onBatch(batch) === false) return;
        }
      }
    );

    const events = await readEvents(await GET(mockEvent('p/')));
    const result = events.at(-1);
    expect(calls).toBe(2);
    expect(result).toMatchObject({ type: 'complete', totalKeys: 3, truncated: true });
  });

  it('sends an error event and closes the stream when the listing fails', async () => {
    mockProvider.listAllKeysProgressively.mockRejectedValue(new Error('Access Denied'));

    const events = await readEvents(await GET(mockEvent('p/')));
    expect(events).toEqual([{ type: 'error', message: 'Access Denied' }]);
  });

  it('aborts the listing when the client goes away', async () => {
    let listingSignal: AbortSignal | undefined;
    mockProvider.listAllKeysProgressively.mockImplementation(
      (_prefix: string, onBatch: OnBatch, options?: ProgressiveListOptions) => {
        listingSignal = options?.signal;
        onBatch([{ key: 'p/a', size: 1 }]);
        return new Promise<void>((_, reject) =>
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        );
      }
    );

    const response = await GET(mockEvent('p/'));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(listingSignal?.aborted).toBe(true);
  });

  it('aborts the listing when the request signal fires', async () => {
    let listingSignal: AbortSignal | undefined;
    mockProvider.listAllKeysProgressively.mockImplementation(
      (_prefix: string, _onBatch: OnBatch, options?: ProgressiveListOptions) => {
        listingSignal = options?.signal;
        return new Promise<void>(() => {});
      }
    );
    const client = new AbortController();

    await GET(mockEvent('p/', client.signal));
    client.abort();
    expect(listingSignal?.aborted).toBe(true);
  });
});
