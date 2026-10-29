import { error, isHttpError } from '@sveltejs/kit';
import type { DirectorySizeEvent } from '$lib/storage/details-types.js';
import {
  DIRECTORY_SIZE_MAX_KEYS,
  DirectorySizeAggregator
} from '$lib/server/storage/directory-tree.js';
import { createStorageProvider } from '$lib/server/storage/request-context.js';
import { storageDirectorySizeCalculationsTotal } from '$lib/server/metrics.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  const { provider, bucket } = createStorageProvider(event);
  const prefix = event.url.searchParams.get('prefix');
  const log = event.locals.logger;

  if (!prefix) throw error(400, 'Missing required query parameter: prefix');

  log.debug({ bucket, prefix }, 'calculating directory size');

  const aggregator = new DirectorySizeAggregator(prefix, DIRECTORY_SIZE_MAX_KEYS);
  const startTime = Date.now();
  const encoder = new TextEncoder();
  // Aborted when the client disconnects, so the listing stops with it.
  const abort = new AbortController();
  event.request.signal.addEventListener('abort', () => abort.abort(), { once: true });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: DirectorySizeEvent) => {
        if (!abort.signal.aborted) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
      };
      // After cancel() the stream is already closed, and close() throws.
      const closeQuietly = () => {
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      try {
        await provider.listAllKeysProgressively(
          prefix,
          (batch) => {
            if (abort.signal.aborted) return false;
            const more = aggregator.add(batch);
            send({
              type: 'progress',
              keysFound: aggregator.totalKeys,
              totalSize: aggregator.totalSize
            });
            return more;
          },
          { signal: abort.signal }
        );
      } catch (err) {
        if (abort.signal.aborted) {
          storageDirectorySizeCalculationsTotal.inc({ outcome: 'aborted' });
          log.debug({ bucket, prefix }, 'directory size cancelled by client');
          closeQuietly();
          return;
        }
        storageDirectorySizeCalculationsTotal.inc({ outcome: 'error' });
        log.warn({ err, bucket, prefix }, 'directory size calculation failed');
        // SvelteKit's HttpError (e.g. a mapped S3 403) is not an Error instance.
        const message = isHttpError(err)
          ? err.body.message
          : err instanceof Error
            ? err.message
            : 'Unknown error';
        send({ type: 'error', message });
        controller.close();
        return;
      }

      if (abort.signal.aborted) {
        storageDirectorySizeCalculationsTotal.inc({ outcome: 'aborted' });
        log.debug({ bucket, prefix }, 'directory size cancelled by client');
        closeQuietly();
        return;
      }

      const durationMs = Date.now() - startTime;
      const result = aggregator.result(durationMs);
      storageDirectorySizeCalculationsTotal.inc({
        outcome: result.truncated ? 'truncated' : 'complete'
      });
      log.info(
        {
          bucket,
          prefix,
          total_keys: result.totalKeys,
          truncated: result.truncated,
          duration_ms: durationMs
        },
        'directory size calculated'
      );
      send(result);
      controller.close();
    },
    cancel() {
      abort.abort();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
};
