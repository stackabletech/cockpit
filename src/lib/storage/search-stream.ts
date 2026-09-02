import type { SearchResultItem, StorageSearchResponse, StorageSearchUpdate } from './types.js';
import { StorageError, type StorageErrorCode } from './errors.js';

interface SearchStreamEvent {
  type: 'batch' | 'snapshot' | 'complete' | 'error';
  results?: SearchResultItem[];
  truncated?: boolean;
  code?: StorageErrorCode;
  message?: string;
}

export async function readSearchStream(
  stream: ReadableStream<Uint8Array> | null,
  onUpdate?: (update: StorageSearchUpdate) => void
): Promise<StorageSearchResponse> {
  if (!stream) throw new Error('Search response did not include a body');

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const results = new Map<string, SearchResultItem>();
  let truncated = false;
  let buffer = '';

  const apply = (event: SearchStreamEvent, snapshot: boolean): void => {
    const eventResults = (event.results ?? []).map((result) => ({
      ...result,
      lastModified: new Date(result.lastModified)
    }));
    if (snapshot) results.clear();
    for (const result of eventResults) results.set(result.key, result);
    truncated = event.truncated ?? truncated;
    onUpdate?.({ results: [...results.values()], truncated, snapshot });
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as SearchStreamEvent;
        if (event.type === 'error') {
          throw new StorageError(event.code ?? 'unknown', event.message ?? 'Search failed');
        }
        if (event.type === 'batch') apply(event, false);
        if (event.type === 'snapshot' || event.type === 'complete') apply(event, true);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return { results: [...results.values()], truncated };
}
