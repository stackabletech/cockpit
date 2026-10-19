/**
 * Shared NDJSON (newline-delimited JSON) reader for streamed storage responses
 * such as transfer progress events.
 */

/** A line of the stream is not valid JSON: a server or protocol bug, not a dropped connection. */
export class NdjsonParseError extends Error {}

/**
 * Read an NDJSON stream line by line, passing each parsed line to `onLine`.
 * Throws NdjsonParseError for a malformed line; errors from `onLine` propagate.
 */
export async function readNdjsonLines(
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: unknown) => void
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(parseLine(line));
      }
    }
    if (buffer.trim()) onLine(parseLine(buffer));
  } finally {
    reader.releaseLock();
  }
}

function parseLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    throw new NdjsonParseError(`Malformed NDJSON line: ${line.slice(0, 100)}`);
  }
}
