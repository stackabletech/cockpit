import { describe, it, expect } from 'vitest';
import { readNdjsonLines } from './ndjson-stream.js';

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

async function collect(stream: ReadableStream<Uint8Array> | null): Promise<unknown[]> {
  const lines: unknown[] = [];
  await readNdjsonLines(stream, (line) => lines.push(line));
  return lines;
}

describe('readNdjsonLines', () => {
  it('reads nothing from a missing stream', async () => {
    expect(await collect(null)).toEqual([]);
  });

  it('parses lines split across chunks and skips blank lines', async () => {
    const stream = createStream(['{"a":1}\n{"b"', ':2}\n\n', '{"c":3}']);
    expect(await collect(stream)).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('throws on a malformed line', async () => {
    await expect(collect(createStream(['{"a":\n']))).rejects.toThrow();
  });
});
