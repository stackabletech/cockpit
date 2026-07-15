import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import { requireBucket } from '../params.js';
import { computeDestinations, uniqueDestKey } from '$lib/server/storage/operations.js';
import { createProgressStream } from '$lib/server/storage/streaming.js';
import { createJob } from '$lib/server/storage/job-store.js';

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

  if (!streamProgress) {
    const destinations = await computeDestinations(
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

  if (body.jobId) {
    createJob(body.jobId);
  }

  return createProgressStream(
    (emit) => {
      const run = async () => {
        const destinations = await computeDestinations(
          provider,
          body.sourceKeys,
          body.destinationPrefix
        );
        const moved: Array<{ sourceKey: string; destKey: string }> = [];
        const failed: Array<{ sourceKey: string; error: string }> = [];

        for (const { sourceKey, baseDestKey } of destinations) {
          try {
            const destKey = await uniqueDestKey(provider, baseDestKey);
            let reportedAnyProgress = false;
            await provider.copyObject(sourceKey, destKey, (loaded, total) => {
              reportedAnyProgress = true;
              emit({ type: 'progress', sourceKey, destKey, loaded, total });
            });

            if (!reportedAnyProgress) {
              try {
                const meta = await provider.getMetadata(sourceKey);
                emit({
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
            emit({ type: 'done', sourceKey, destKey });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            failed.push({ sourceKey, error: message });
            locals.logger.warn(
              { bucket, source_key: sourceKey, dest_key: baseDestKey, error: message },
              'move copy failed for key'
            );
            emit({ type: 'failed', sourceKey, error: message });
          }
        }

        const keysToDelete = [...new Set(moved.map((m) => m.sourceKey))];
        if (keysToDelete.length > 0) {
          emit({ type: 'status', message: `Deleting ${keysToDelete.length} original(s)` });
          const deleteResult = await provider.deleteObjects(keysToDelete);
          for (const f of deleteResult.failed) {
            failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
            locals.logger.warn({ bucket, key: f.key }, 'move delete failed for key');
          }
        }

        locals.logger.info(
          { bucket, moved: moved.length, failed: failed.length },
          'move completed'
        );

        return { results: moved, failed };
      };

      return run();
    },
    {
      jobId: body.jobId,
      operationName: 'move',
      logger: locals.logger,
      bucket,
      buildCompletePayload: (result) => ({
        type: 'complete',
        moved: result.results,
        failed: result.failed
      })
    }
  );
};
