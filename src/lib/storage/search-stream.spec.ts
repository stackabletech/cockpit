import { describe, expect, it, vi } from 'vitest';
import { readSearchStream } from './search-stream.js';
import { StorageError } from './errors.js';

function createStream(events: object[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      controller.close();
    }
  });
}

describe('readSearchStream', () => {
  it('applies incremental batches and replaces them with snapshots', async () => {
    const onUpdate = vi.fn();
    const result = await readSearchStream(
      createStream([
        {
          type: 'batch',
          results: [{ key: 'old.txt', size: 1, lastModified: '2026-01-01', isDirectory: false }]
        },
        {
          type: 'snapshot',
          results: [{ key: 'new.txt', size: 2, lastModified: '2026-01-02', isDirectory: false }]
        },
        { type: 'complete', results: [] }
      ]),
      onUpdate
    );

    expect(onUpdate).toHaveBeenNthCalledWith(2, {
      snapshot: true,
      results: [expect.objectContaining({ key: 'new.txt', lastModified: expect.any(Date) })]
    });
    expect(result).toEqual({ results: [] });
  });

  it('throws a streamed error', async () => {
    await expect(
      readSearchStream(createStream([{ type: 'error', message: 'Failed' }]))
    ).rejects.toThrow('Failed');
  });

  it('preserves a streamed error classification', async () => {
    await expect(
      readSearchStream(createStream([{ type: 'error', code: 'access_denied', message: 'Denied' }]))
    ).rejects.toMatchObject(new StorageError('access_denied', 'Denied'));
  });
});
