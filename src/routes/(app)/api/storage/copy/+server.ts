import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import { requireBucket } from '../params.js';

/**
 * Compute copy destinations for each source key, expanding directories
 * to their full recursive listing while preserving the relative path
 * structure under the destination prefix.
 */
async function computeCopyDestinations(
  provider: StorageProvider,
  sourceKeys: string[],
  destinationPrefix: string
): Promise<Array<{ sourceKey: string; baseDestKey: string }>> {
  const destinations: Array<{ sourceKey: string; baseDestKey: string }> = [];

  for (const key of sourceKeys) {
    const name = key.endsWith('/')
      ? key.split('/').filter(Boolean).pop() + '/'
      : key.split('/').pop();

    if (!key.endsWith('/')) {
      destinations.push({ sourceKey: key, baseDestKey: destinationPrefix + name });
    } else {
      const children = await provider.listAllKeys(key);
      // listAllKeys returns ALL keys starting with the prefix, which
      // includes the directory marker itself. We add it explicitly and
      // skip it when iterating children to avoid a duplicate that would
      // cause uniqueDestKey to append a "(1)" suffix.
      destinations.push({ sourceKey: key, baseDestKey: destinationPrefix + name });
      for (const child of children) {
        if (child === key) continue;
        const relPath = child.slice(key.length);
        destinations.push({ sourceKey: child, baseDestKey: destinationPrefix + name + relPath });
      }
    }
  }

  return destinations;
}

/**
 * Given a desired destination key, check if it already exists and generate
 * a unique name by appending ` (1)`, ` (2)`, etc. before the extension.
 * Returns the first key that does not exist.
 */
async function uniqueDestKey(provider: StorageProvider, baseKey: string): Promise<string> {
  if (!(await provider.exists(baseKey))) return baseKey;

  // Split name and extension
  const name = baseKey.endsWith('/') ? baseKey.slice(0, -1) : baseKey;
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot > 0 ? name.slice(0, lastDot) : name;
  const ext = lastDot > 0 && !baseKey.endsWith('/') ? name.slice(lastDot) : '';

  const suffix = baseKey.endsWith('/') ? '/' : '';

  let counter = 1;
  while (true) {
    const candidate = `${stem} (${counter})${ext}${suffix}`;
    if (!(await provider.exists(candidate))) return candidate;
    counter++;
  }
}

/**
 * Encode a value as a single NDJSON line (newline-delimited JSON).
 */
function ndjsonLine(data: Record<string, unknown>): string {
  return JSON.stringify(data) + '\n';
}

export const POST: RequestHandler = async ({ locals, request, url }) => {
  const bucket = requireBucket(url);
  const streamProgress = url.searchParams.get('progress') === 'true';

  const body = (await request.json()) as {
    sourceKeys: string[];
    destinationPrefix: string;
  };
  if (!body.sourceKeys?.length) {
    throw error(400, 'Missing required body field: sourceKeys');
  }
  if (body.destinationPrefix === undefined) {
    throw error(400, 'Missing required body field: destinationPrefix');
  }

  locals.logger.debug(
    {
      bucket,
      source_key_count: body.sourceKeys.length,
      destination_prefix: body.destinationPrefix,
      stream_progress: streamProgress
    },
    'copy request received'
  );

  const provider = getProvider(locals.storageConfig!, bucket);

  // ── Non-streaming path (original behaviour) ──────────────────────────────
  if (!streamProgress) {
    const destinations = await computeCopyDestinations(
      provider,
      body.sourceKeys,
      body.destinationPrefix
    );
    const results: Array<{ sourceKey: string; destKey: string }> = [];
    const failed: Array<{ sourceKey: string; error: string }> = [];

    for (const { sourceKey, baseDestKey } of destinations) {
      try {
        const destKey = await uniqueDestKey(provider, baseDestKey);
        await provider.copyObject(sourceKey, destKey);
        results.push({ sourceKey, destKey });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ sourceKey, error: message });
        locals.logger.warn(
          { bucket, source_key: sourceKey, dest_key: baseDestKey, error: message },
          'copy failed for key'
        );
      }
    }

    locals.logger.info({ bucket, copied: results.length, failed: failed.length }, 'copy completed');
    return json({ results, failed });
  }

  // ── Streaming progress path ──────────────────────────────────────────────
  const destinations = await computeCopyDestinations(
    provider,
    body.sourceKeys,
    body.destinationPrefix
  );
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const results: Array<{ sourceKey: string; destKey: string }> = [];
      const failed: Array<{ sourceKey: string; error: string }> = [];

      for (const { sourceKey, baseDestKey } of destinations) {
        try {
          const destKey = await uniqueDestKey(provider, baseDestKey);

          // For files that might be large, we stream progress events.
          // copyObject only calls onProgress for >5 GB files (multipart upload).
          let reportedAnyProgress = false;
          await provider.copyObject(sourceKey, destKey, (loaded, total) => {
            reportedAnyProgress = true;
            controller.enqueue(
              encoder.encode(ndjsonLine({ type: 'progress', sourceKey, destKey, loaded, total }))
            );
          });

          // If copyObject used S3 CopyObject (small file), no onProgress was
          // fired. Emit a synthetic 100% event so the client knows it's done.
          if (!reportedAnyProgress) {
            // Fetch the size for a useful event
            try {
              const meta = await provider.getMetadata(sourceKey);
              controller.enqueue(
                encoder.encode(
                  ndjsonLine({
                    type: 'progress',
                    sourceKey,
                    destKey,
                    loaded: meta.size,
                    total: meta.size
                  })
                )
              );
            } catch {
              // Metadata fetch failed — emit without size info
            }
          }

          results.push({ sourceKey, destKey });
          controller.enqueue(encoder.encode(ndjsonLine({ type: 'done', sourceKey, destKey })));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          failed.push({ sourceKey, error: message });
          locals.logger.warn(
            { bucket, source_key: sourceKey, dest_key: baseDestKey, error: message },
            'copy failed for key'
          );
          controller.enqueue(
            encoder.encode(ndjsonLine({ type: 'failed', sourceKey, error: message }))
          );
        }
      }

      locals.logger.info(
        { bucket, copied: results.length, failed: failed.length },
        'copy completed'
      );

      // Final summary line
      controller.enqueue(encoder.encode(ndjsonLine({ type: 'complete', results, failed })));
      controller.close();
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
};
