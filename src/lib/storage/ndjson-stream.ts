/**
 * Shared NDJSON streaming reader for storage operation progress events.
 *
 * The server returns NDJSON (newline-delimited JSON) for copy/move operations
 * when ?progress=true. Each line is a typed event:
 *
 *   {"type":"progress","sourceKey":"...","destKey":"...","loaded":N,"total":N}
 *   {"type":"done","sourceKey":"...","destKey":"..."}
 *   {"type":"failed","sourceKey":"...","error":"..."}
 *   {"type":"complete","results":[...],"failed":[...]}
 *   {"type":"status","message":"..."}
 *
 * This module extracts the buffered-reader + parse + dispatch loop that was
 * previously duplicated across three places in StorageState.
 */

export interface NdjsonStreamEvent {
  type: string;
  sourceKey?: string;
  destKey?: string;
  loaded?: number;
  total?: number;
  error?: string;
  results?: Array<{ sourceKey: string; destKey: string }>;
  moved?: Array<{ sourceKey: string; destKey: string }>;
  failed?: Array<{ sourceKey: string; error: string }>;
  message?: string;
}

export interface NdjsonStreamCallbacks {
  onProgress?: (sourceKey: string, destKey: string, loaded: number, total: number) => void;
  onDone?: (sourceKey: string, destKey: string) => void;
  onFailed?: (sourceKey: string, error: string) => void;
  onComplete?: (
    results: Array<{ sourceKey: string; destKey: string }>,
    failed: Array<{ sourceKey: string; error: string }>
  ) => void;
  onStatus?: (message: string) => void;
}

export interface NdjsonStreamResult {
  results: Array<{ sourceKey: string; destKey: string }>;
  failed: Array<{ sourceKey: string; error: string }>;
}

/**
 * Read an NDJSON stream from a fetch Response body, dispatching typed events
 * to the provided callbacks.
 *
 * Returns the aggregated results and failures. The `complete` event (if present)
 * replaces any results/failures accumulated from individual `done`/`failed`
 * events, matching the server's convention of sending a final summary line.
 */
export async function readNdjsonStream(
  stream: ReadableStream<Uint8Array> | null,
  callbacks: NdjsonStreamCallbacks = {}
): Promise<NdjsonStreamResult> {
  const results: Array<{ sourceKey: string; destKey: string }> = [];
  const failed: Array<{ sourceKey: string; error: string }> = [];

  if (!stream) return { results, failed };

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
        if (!line.trim()) continue;
        const event = JSON.parse(line) as NdjsonStreamEvent;

        switch (event.type) {
          case 'progress':
            if (event.loaded !== undefined && event.total !== undefined) {
              callbacks.onProgress?.(
                event.sourceKey ?? '',
                event.destKey ?? '',
                event.loaded,
                event.total
              );
            }
            break;

          case 'done':
            if (event.sourceKey && event.destKey) {
              results.push({ sourceKey: event.sourceKey, destKey: event.destKey });
              callbacks.onDone?.(event.sourceKey, event.destKey);
            }
            break;

          case 'failed':
            if (event.sourceKey) {
              failed.push({ sourceKey: event.sourceKey, error: event.error ?? 'Unknown error' });
              callbacks.onFailed?.(event.sourceKey, event.error ?? 'Unknown error');
            }
            break;

          case 'complete': {
            const finalResults = (event.results ?? event.moved) as
              | Array<{ sourceKey: string; destKey: string }>
              | undefined;
            const finalFailed = event.failed as
              | Array<{ sourceKey: string; error: string }>
              | undefined;
            if (finalResults) {
              results.length = 0;
              results.push(...finalResults);
            }
            if (finalFailed) {
              failed.length = 0;
              failed.push(...finalFailed);
            }
            callbacks.onComplete?.(finalResults ?? results, finalFailed ?? failed);
            break;
          }

          case 'status':
            callbacks.onStatus?.(event.message ?? '');
            break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { results, failed };
}
