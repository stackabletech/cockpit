import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import {
  SEARCH_DEFAULT_MAX_RESULTS,
  SEARCH_DEFAULT_MAX_KEYS_SCANNED
} from '$lib/server/storage/provider.js';
import { createSafeSearchRegex, UnsafeSearchRegexError } from '$lib/storage/search-regex.js';
import { compileFilterPredicates, parseFilterParam } from '$lib/storage/search-filter.js';
import { storageSearchTotal } from '$lib/server/metrics.js';
import type { SearchResultItem } from '$lib/storage/types.js';
import type { RequestHandler } from './$types';

const SNAPSHOT_INTERVAL = 10;

export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const query = event.url.searchParams.get('q')?.trim() ?? '';
  const log = event.locals.logger;
  const prefix = event.url.searchParams.get('prefix') ?? '';
  const maxDepthParam = event.url.searchParams.get('maxDepth');
  const maxDepth = maxDepthParam === null ? undefined : Number(maxDepthParam);
  if (!query) throw error(400, 'Missing required query parameter: q');
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 20)) {
    throw error(400, 'maxDepth must be an integer between 1 and 20');
  }

  const useRegex = event.url.searchParams.get('regex') === 'true';
  const excludePatterns = event.url.searchParams.getAll('exclude').filter(Boolean);
  const filters = event.url.searchParams
    .getAll('filter')
    .map(parseFilterParam)
    .filter((filter): filter is NonNullable<typeof filter> => filter !== null);
  let regex: RegExp | undefined;
  if (useRegex) {
    try {
      regex = createSafeSearchRegex(query);
    } catch (err) {
      if (err instanceof UnsafeSearchRegexError) throw error(400, err.message);
      throw err;
    }
  }
  const matchesFilters = compileFilterPredicates(filters);

  log.debug(
    {
      bucket,
      query,
      prefix,
      max_depth: maxDepth,
      use_regex: useRegex,
      exclude_count: excludePatterns.length,
      filter_count: filters.length
    },
    'running storage search'
  );

  try {
    const additionalBuckets = event.locals.storageConfig?.additionalBuckets ?? [];
    const buckets = await provider.listContainers();
    if (!new Set([...buckets, ...additionalBuckets]).has(bucket)) {
      throw error(404, 'Storage bucket not found');
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const results: SearchResultItem[] = [];
        let matchesSinceSnapshot = 0;
        const send = (
          type: 'batch' | 'snapshot' | 'complete',
          eventResults: SearchResultItem[],
          truncated?: boolean
        ) => {
          controller.enqueue(
            encoder.encode(JSON.stringify({ type, results: eventResults, truncated }) + '\n')
          );
        };

        try {
          const result = await provider.search(query, {
            maxResults: SEARCH_DEFAULT_MAX_RESULTS,
            maxKeysScanned: SEARCH_DEFAULT_MAX_KEYS_SCANNED,
            prefix,
            maxDepth,
            signal: event.request.signal,
            matches: (item) => {
              const matched = regex
                ? regex.test(item.key)
                : item.key.toLowerCase().includes(query.toLowerCase());
              return (
                matched &&
                !excludePatterns.some((pattern) => item.key.includes(pattern)) &&
                matchesFilters(item)
              );
            },
            onMatch: (item) => {
              results.push(item);
              matchesSinceSnapshot++;
              if (matchesSinceSnapshot >= SNAPSHOT_INTERVAL) {
                send('snapshot', results);
                matchesSinceSnapshot = 0;
              } else {
                send('batch', [item]);
              }
            }
          });
          send('complete', result.results, result.truncated);
          storageSearchTotal.inc({ outcome: 'success', truncated: String(result.truncated) });
          log.info(
            {
              bucket,
              query,
              prefix,
              max_depth: maxDepth,
              result_count: result.results.length,
              truncated: result.truncated
            },
            'storage search completed'
          );
        } catch (err) {
          storageSearchTotal.inc({ outcome: 'error', truncated: 'false' });
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'error',
                message: err instanceof Error ? err.message : 'Search failed'
              }) + '\n'
            )
          );
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    });
  } catch (err) {
    storageSearchTotal.inc({ outcome: 'error', truncated: 'false' });
    throw err;
  }
};
