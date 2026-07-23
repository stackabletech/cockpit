import { describe, it, expect, vi } from 'vitest';
import { readNdjsonStream } from './ndjson-stream.js';

function createStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line + '\n'));
      }
      controller.close();
    }
  });
}

describe('readNdjsonStream', () => {
  it('returns empty results for null stream', async () => {
    const result = await readNdjsonStream(null);
    expect(result).toEqual({ results: [], failed: [] });
  });

  it('parses progress events and calls onProgress', async () => {
    const onProgress = vi.fn();
    const stream = createStream([
      JSON.stringify({
        type: 'progress',
        sourceKey: 'a.txt',
        destKey: 'b.txt',
        loaded: 50,
        total: 100
      })
    ]);

    const result = await readNdjsonStream(stream, { onProgress });

    expect(onProgress).toHaveBeenCalledWith('a.txt', 'b.txt', 50, 100);
    expect(result.results).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  it('parses done events and accumulates results', async () => {
    const onDone = vi.fn();
    const stream = createStream([
      JSON.stringify({ type: 'done', sourceKey: 'a.txt', destKey: 'b.txt' }),
      JSON.stringify({ type: 'done', sourceKey: 'c.txt', destKey: 'd.txt' })
    ]);

    const result = await readNdjsonStream(stream, { onDone });

    expect(result.results).toEqual([
      { sourceKey: 'a.txt', destKey: 'b.txt' },
      { sourceKey: 'c.txt', destKey: 'd.txt' }
    ]);
    expect(onDone).toHaveBeenCalledTimes(2);
  });

  it('ignores done events missing sourceKey or destKey', async () => {
    const stream = createStream([
      JSON.stringify({ type: 'done', sourceKey: '', destKey: 'b.txt' })
    ]);

    const result = await readNdjsonStream(stream);

    expect(result.results).toEqual([]);
  });

  it('parses failed events and accumulates failures', async () => {
    const onFailed = vi.fn();
    const stream = createStream([
      JSON.stringify({ type: 'failed', sourceKey: 'a.txt', error: 'Access denied' })
    ]);

    const result = await readNdjsonStream(stream, { onFailed });

    expect(result.failed).toEqual([{ sourceKey: 'a.txt', error: 'Access denied' }]);
    expect(onFailed).toHaveBeenCalledWith('a.txt', 'Access denied');
  });

  it('uses default error message when error field is missing', async () => {
    const stream = createStream([JSON.stringify({ type: 'failed', sourceKey: 'a.txt' })]);

    const result = await readNdjsonStream(stream);

    expect(result.failed).toEqual([{ sourceKey: 'a.txt', error: 'Unknown error' }]);
  });

  it('ignores failed events missing sourceKey', async () => {
    const stream = createStream([JSON.stringify({ type: 'failed', error: 'err' })]);

    const result = await readNdjsonStream(stream);

    expect(result.failed).toEqual([]);
  });

  it('handles complete event with results and failed', async () => {
    const onComplete = vi.fn();
    const stream = createStream([
      JSON.stringify({
        type: 'complete',
        results: [{ sourceKey: 'a.txt', destKey: 'b.txt' }],
        failed: [{ sourceKey: 'c.txt', error: 'err' }]
      })
    ]);

    const result = await readNdjsonStream(stream, { onComplete });

    expect(result.results).toEqual([{ sourceKey: 'a.txt', destKey: 'b.txt' }]);
    expect(result.failed).toEqual([{ sourceKey: 'c.txt', error: 'err' }]);
    expect(onComplete).toHaveBeenCalledWith(
      [{ sourceKey: 'a.txt', destKey: 'b.txt' }],
      [{ sourceKey: 'c.txt', error: 'err' }]
    );
  });

  it('complete event replaces previously accumulated results', async () => {
    const stream = createStream([
      JSON.stringify({ type: 'done', sourceKey: 'old.txt', destKey: 'old2.txt' }),
      JSON.stringify({ type: 'failed', sourceKey: 'old3.txt', error: 'err' }),
      JSON.stringify({
        type: 'complete',
        results: [{ sourceKey: 'a.txt', destKey: 'b.txt' }],
        failed: [{ sourceKey: 'c.txt', error: 'err2' }]
      })
    ]);

    const result = await readNdjsonStream(stream);

    expect(result.results).toEqual([{ sourceKey: 'a.txt', destKey: 'b.txt' }]);
    expect(result.failed).toEqual([{ sourceKey: 'c.txt', error: 'err2' }]);
  });

  it('complete event with moved key (backward compat)', async () => {
    const stream = createStream([
      JSON.stringify({
        type: 'complete',
        moved: [{ sourceKey: 'a.txt', destKey: 'b.txt' }],
        failed: []
      })
    ]);

    const result = await readNdjsonStream(stream);

    expect(result.results).toEqual([{ sourceKey: 'a.txt', destKey: 'b.txt' }]);
  });

  it('calls onStatus with message', async () => {
    const onStatus = vi.fn();
    const stream = createStream([JSON.stringify({ type: 'status', message: 'Processing...' })]);

    await readNdjsonStream(stream, { onStatus });

    expect(onStatus).toHaveBeenCalledWith('Processing...');
  });

  it('handles empty lines gracefully', async () => {
    const stream = createStream([
      '',
      '  ',
      JSON.stringify({ type: 'done', sourceKey: 'a.txt', destKey: 'b.txt' })
    ]);

    const result = await readNdjsonStream(stream);

    expect(result.results).toEqual([{ sourceKey: 'a.txt', destKey: 'b.txt' }]);
  });

  it('handles chunked decoding across buffer boundaries', async () => {
    const encoder = new TextEncoder();
    const data = JSON.stringify({ type: 'done', sourceKey: 'a.txt', destKey: 'b.txt' }) + '\n';
    const mid = Math.floor(data.length / 2);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(data.slice(0, mid)));
        controller.enqueue(encoder.encode(data.slice(mid)));
        controller.close();
      }
    });

    const result = await readNdjsonStream(stream);

    expect(result.results).toEqual([{ sourceKey: 'a.txt', destKey: 'b.txt' }]);
  });

  it('releases reader lock on completion', async () => {
    const stream = createStream([
      JSON.stringify({ type: 'done', sourceKey: 'a.txt', destKey: 'b.txt' })
    ]);

    await readNdjsonStream(stream);

    expect(() => stream.getReader()).not.toThrow();
  });
});
