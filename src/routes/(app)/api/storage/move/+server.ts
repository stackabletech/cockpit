import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import { requireBucket } from '../params.js';

/**
 * Expand source keys so that directory prefixes are replaced by their
 * full recursive listing (including the directory marker).
 */
async function expandKeys(provider: StorageProvider, keys: string[]): Promise<string[]> {
  const expanded: string[] = [];
  for (const key of keys) {
    if (key.endsWith('/')) {
      const children = await provider.listAllKeys(key);
      expanded.push(key, ...children);
    } else {
      expanded.push(key);
    }
  }
  return expanded;
}

/**
 * Given a desired destination key, check if it already exists and generate
 * a unique name by appending ` (1)`, ` (2)`, etc. before the extension.
 */
async function uniqueDestKey(provider: StorageProvider, baseKey: string): Promise<string> {
  if (!(await provider.exists(baseKey))) return baseKey;

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
    'move request received'
  );

  const provider = getProvider(locals.storageConfig!, bucket);

  // Expand directories to their full recursive listing
  const expanded = await expandKeys(provider, body.sourceKeys);

  // ── Non-streaming path ───────────────────────────────────────────────────
  if (!streamProgress) {
    const moved: Array<{ sourceKey: string; destKey: string }> = [];
    const failed: Array<{ sourceKey: string; error: string }> = [];

    for (const sourceKey of expanded) {
      const name = sourceKey.endsWith('/')
        ? sourceKey.split('/').slice(-2, -1)[0] + '/'
        : sourceKey.split('/').pop();
      const baseDestKey = body.destinationPrefix + name;

      try {
        const destKey = await uniqueDestKey(provider, baseDestKey);
        await provider.copyObject(sourceKey, destKey);
        moved.push({ sourceKey, destKey });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ sourceKey, error: message });
        locals.logger.warn(
          { bucket, source_key: sourceKey, dest_key: baseDestKey, error: message },
          'move copy failed for key'
        );
      }
    }

    // Delete originals for successfully moved items
    const keysToDelete = [...new Set(moved.map((m) => m.sourceKey))];
    if (keysToDelete.length > 0) {
      const deleteResult = await provider.deleteObjects(keysToDelete);
      for (const f of deleteResult.failed) {
        failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
        locals.logger.warn({ bucket, key: f.key }, 'move delete failed for key');
      }
    }

    locals.logger.info({ bucket, moved: moved.length, failed: failed.length }, 'move completed');
    return json({ moved, failed });
  }

  // ── Streaming progress path ──────────────────────────────────────────────
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const moved: Array<{ sourceKey: string; destKey: string }> = [];
      const failed: Array<{ sourceKey: string; error: string }> = [];

      for (const sourceKey of expanded) {
        const name = sourceKey.endsWith('/')
          ? sourceKey.split('/').slice(-2, -1)[0] + '/'
          : sourceKey.split('/').pop();
        const baseDestKey = body.destinationPrefix + name;

        try {
          const destKey = await uniqueDestKey(provider, baseDestKey);
          let reportedAnyProgress = false;
          await provider.copyObject(sourceKey, destKey, (loaded, total) => {
            reportedAnyProgress = true;
            controller.enqueue(
              encoder.encode(ndjsonLine({ type: 'progress', sourceKey, destKey, loaded, total }))
            );
          });

          if (!reportedAnyProgress) {
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
              // Metadata fetch failed
            }
          }

          moved.push({ sourceKey, destKey });
          controller.enqueue(encoder.encode(ndjsonLine({ type: 'done', sourceKey, destKey })));
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          failed.push({ sourceKey, error: message });
          locals.logger.warn(
            { bucket, source_key: sourceKey, dest_key: baseDestKey, error: message },
            'move copy failed for key'
          );
          controller.enqueue(
            encoder.encode(ndjsonLine({ type: 'failed', sourceKey, error: message }))
          );
        }
      }

      // Delete originals for successfully moved items
      const keysToDelete = [...new Set(moved.map((m) => m.sourceKey))];
      if (keysToDelete.length > 0) {
        controller.enqueue(
          encoder.encode(
            ndjsonLine({
              type: 'status',
              message: `Deleting ${keysToDelete.length} original(s)`
            })
          )
        );
        const deleteResult = await provider.deleteObjects(keysToDelete);
        for (const f of deleteResult.failed) {
          failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
          locals.logger.warn({ bucket, key: f.key }, 'move delete failed for key');
        }
      }

      locals.logger.info({ bucket, moved: moved.length, failed: failed.length }, 'move completed');

      controller.enqueue(encoder.encode(ndjsonLine({ type: 'complete', moved, failed })));
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
