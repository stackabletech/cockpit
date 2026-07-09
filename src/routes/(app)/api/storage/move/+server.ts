import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';
import { requireBucket } from '../params.js';
import {
  createJob,
  completeJob,
  failJob,
  updateJobProgress
} from '$lib/server/storage/job-store.js';

/**
 * Compute move destinations for each source key, expanding directories
 * to their full recursive listing while preserving the relative path
 * structure under the destination prefix.
 */
async function computeMoveDestinations(
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
    jobId?: string;
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

  // ── Non-streaming path ───────────────────────────────────────────────────
  if (!streamProgress) {
    const destinations = await computeMoveDestinations(
      provider,
      body.sourceKeys,
      body.destinationPrefix
    );
    const moved: Array<{ sourceKey: string; destKey: string }> = [];
    const failed: Array<{ sourceKey: string; error: string }> = [];

    for (const { sourceKey, baseDestKey } of destinations) {
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
  const destinations = await computeMoveDestinations(
    provider,
    body.sourceKeys,
    body.destinationPrefix
  );
  const encoder = new TextEncoder();

  type ProgressEvent =
    | { type: 'progress'; sourceKey: string; destKey: string; loaded: number; total: number }
    | { type: 'done'; sourceKey: string; destKey: string }
    | { type: 'failed'; sourceKey: string; error: string }
    | { type: 'status'; message: string };

  let emitEvent: (event: ProgressEvent) => void = () => {};

  const movePromise = (async (): Promise<{
    moved: Array<{ sourceKey: string; destKey: string }>;
    failed: Array<{ sourceKey: string; error: string }>;
  }> => {
    const moved: Array<{ sourceKey: string; destKey: string }> = [];
    const failed: Array<{ sourceKey: string; error: string }> = [];

    for (const { sourceKey, baseDestKey } of destinations) {
      try {
        const destKey = await uniqueDestKey(provider, baseDestKey);
        let reportedAnyProgress = false;
        await provider.copyObject(sourceKey, destKey, (loaded, total) => {
          reportedAnyProgress = true;
          emitEvent({ type: 'progress', sourceKey, destKey, loaded, total });
        });

        if (!reportedAnyProgress) {
          try {
            const meta = await provider.getMetadata(sourceKey);
            emitEvent({
              type: 'progress',
              sourceKey,
              destKey,
              loaded: meta.size,
              total: meta.size
            });
          } catch {
            // Metadata fetch failed
          }
        }

        moved.push({ sourceKey, destKey });
        emitEvent({ type: 'done', sourceKey, destKey });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ sourceKey, error: message });
        locals.logger.warn(
          { bucket, source_key: sourceKey, dest_key: baseDestKey, error: message },
          'move copy failed for key'
        );
        emitEvent({ type: 'failed', sourceKey, error: message });
      }
    }

    // Delete originals for successfully moved items
    const keysToDelete = [...new Set(moved.map((m) => m.sourceKey))];
    if (keysToDelete.length > 0) {
      emitEvent({ type: 'status', message: `Deleting ${keysToDelete.length} original(s)` });
      const deleteResult = await provider.deleteObjects(keysToDelete);
      for (const f of deleteResult.failed) {
        failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
        locals.logger.warn({ bucket, key: f.key }, 'move delete failed for key');
      }
    }

    locals.logger.info({ bucket, moved: moved.length, failed: failed.length }, 'move completed');
    return { moved, failed };
  })();

  if (body.jobId) {
    createJob(body.jobId);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const jobId = body.jobId;

      emitEvent = (event) => {
        if (jobId) {
          if (event.type === 'progress') {
            updateJobProgress(jobId, { completedBytes: event.loaded });
          }
        }

        try {
          controller.enqueue(encoder.encode(ndjsonLine(event)));
        } catch {
          // Controller closed (client disconnected) — move continues
          // in the background unaffected.
        }
      };

      const { moved, failed } = await movePromise;

      if (jobId) {
        if (failed.length > 0) {
          failJob(jobId, `Failed to move ${failed.length} item(s)`);
        } else {
          completeJob(jobId, { moved, failed });
        }
      }

      try {
        controller.enqueue(encoder.encode(ndjsonLine({ type: 'complete', moved, failed })));
        controller.close();
      } catch {
        // Client already disconnected
      }
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
