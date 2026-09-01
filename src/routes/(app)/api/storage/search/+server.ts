import { error } from '@sveltejs/kit';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import {
  SEARCH_DEFAULT_MAX_RESULTS,
  SEARCH_DEFAULT_MAX_KEYS_SCANNED
} from '$lib/server/storage/provider.js';
import { storageSearchTotal } from '$lib/server/metrics.js';
import type { RequestHandler } from './$types';

/**
 * GET /api/storage/search?bucket=<bucket>&q=<query>&prefix=<prefix>&maxDepth=<depth>
 *
 * Runs a bounded, bucket-scoped substring search against the storage provider.
 * Requires the `x-storage-connection-id` header (handled by the storage hook).
 * The caller may pass an abort signal tied to modal close by aborting the
 * underlying fetch; the signal is forwarded to the provider.
 */
export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const query = event.url.searchParams.get('q')?.trim();
  if (!query) {
    throw error(400, 'Missing required query parameter: q');
  }
  const log = event.locals.logger;
  const prefix = event.url.searchParams.get('prefix') ?? '';
  const maxDepthParam = event.url.searchParams.get('maxDepth');
  const maxDepth = maxDepthParam === null ? undefined : Number(maxDepthParam);
  if (maxDepth !== undefined && (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 20)) {
    throw error(400, 'maxDepth must be an integer between 1 and 20');
  }

  log.debug({ bucket, query, prefix, max_depth: maxDepth }, 'running storage search');

  try {
    const additionalBuckets = event.locals.storageConfig?.additionalBuckets ?? [];
    const buckets = await provider.listContainers();
    if (!new Set([...buckets, ...additionalBuckets]).has(bucket)) {
      throw error(404, 'Storage bucket not found');
    }

    const result = await provider.search(query, {
      maxResults: SEARCH_DEFAULT_MAX_RESULTS,
      maxKeysScanned: SEARCH_DEFAULT_MAX_KEYS_SCANNED,
      prefix,
      maxDepth,
      signal: event.request.signal
    });

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

    return Response.json(result);
  } catch (err) {
    storageSearchTotal.inc({ outcome: 'error', truncated: 'false' });
    throw err;
  }
};
