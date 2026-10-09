import { error, isHttpError } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { createSafeSearchRegex, UnsafeSearchRegexError } from '$lib/storage/search-regex.js';
import { compileFilterPredicates, parseFilterParam } from '$lib/storage/search-filter.js';
import { storageSearchTotal } from '$lib/server/metrics.js';
import type { SearchResultItem } from '$lib/storage/types.js';
import type { RequestHandler } from './$types';

const BATCH_SIZE = 100;
const MAX_RESULTS = 10_000;

export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const query = event.url.searchParams.get('q')?.trim() ?? '';
  const log = event.locals.logger;
  const prefix = event.url.searchParams.get('prefix') ?? '';
  const maxDepthParam = event.url.searchParams.get('maxDepth');
  const maxDepth = maxDepthParam === null ? undefined : Number(maxDepthParam);
  if (!query) throw error(400, 'Missing required query parameter: q');
  if (query.length > 1024 || prefix.length > 1024) throw error(400, 'Search input is too long');
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 20)) {
    throw error(400, 'maxDepth must be an integer between 1 and 20');
  }

  const useRegex = event.url.searchParams.get('regex') === 'true';
  const excludePatterns = event.url.searchParams.getAll('exclude').filter(Boolean);
  if (
    excludePatterns.length > 50 ||
    excludePatterns.some((pattern) => pattern.length > 1024) ||
    event.url.searchParams.getAll('filter').length > 20
  )
    throw error(400, 'Search filter limits exceeded');
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
    const abort = new AbortController();
    const abortRequest = () => abort.abort();
    event.request.signal.addEventListener('abort', abortRequest, { once: true });
    if (event.request.signal.aborted) abort.abort();
    let cancelled = false;
    const normalisedQuery = query.toLowerCase();
    const stream = new ReadableStream({
      async start(controller) {
        let count = 0;
        let batch: SearchResultItem[] = [];
        const send = (
          type: 'batch' | 'snapshot' | 'complete',
          eventResults: SearchResultItem[]
        ) => {
          if (cancelled) return;
          controller.enqueue(
            encoder.encode(JSON.stringify({ type, results: eventResults }) + '\n')
          );
        };

        try {
          const result = await provider.search(query, {
            prefix,
            maxDepth,
            signal: abort.signal,
            matches: (item) => {
              const matched = regex
                ? regex.test(item.key)
                : item.key.toLowerCase().includes(normalisedQuery);
              return (
                matched &&
                !excludePatterns.some((pattern) => item.key.includes(pattern)) &&
                matchesFilters(item)
              );
            },
            onMatch: (item) => {
              if (++count > MAX_RESULTS)
                throw error(400, 'Search exceeds 10000 results; narrow the query');
              batch.push(item);
              if (batch.length >= BATCH_SIZE) {
                send('batch', batch);
                batch = [];
              }
            }
          });
          if (batch.length) send('batch', batch);
          send('complete', []);
          storageSearchTotal.inc({ outcome: 'success' });
          log.info(
            {
              bucket,
              query,
              prefix,
              max_depth: maxDepth,
              result_count: result.results.length
            },
            'storage search completed'
          );
        } catch (err) {
          if (cancelled || abort.signal.aborted) return;
          if (batch.length) send('batch', batch);
          log.error({ err, bucket }, 'streamed storage search failed');
          storageSearchTotal.inc({ outcome: 'error' });
          const code = isHttpError(err)
            ? err.status === 403
              ? 'access_denied'
              : err.status === 404
                ? 'not_found'
                : err.status >= 500
                  ? 'server_error'
                  : 'unknown'
            : 'unknown';
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: 'error',
                code,
                message: err instanceof Error ? err.message : 'Search failed'
              }) + '\n'
            )
          );
        } finally {
          event.request.signal.removeEventListener('abort', abortRequest);
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        abort.abort();
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
    storageSearchTotal.inc({ outcome: 'error' });
    throw err;
  }
};
