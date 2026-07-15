import type { StorageProvider } from './provider.js';
import type pino from 'pino';
import { json } from '@sveltejs/kit';
import { computeDestinations, uniqueDestKey } from './operations.js';
import { createProgressStream, type StreamableOpResult } from './streaming.js';
import { createJob } from './job-store.js';

export interface PerformCopyOrMoveOptions {
  provider: StorageProvider;
  sourceKeys: string[];
  destinationPrefix: string;
  streamProgress: boolean;
  logger: pino.Logger;
  bucket: string;
  jobId?: string;
  deleteOriginals: boolean;
}

export async function performCopyOrMove(options: PerformCopyOrMoveOptions): Promise<Response> {
  const {
    provider,
    sourceKeys,
    destinationPrefix,
    streamProgress,
    logger,
    bucket,
    jobId,
    deleteOriginals
  } = options;

  const operationName = deleteOriginals ? 'move' : 'copy';
  const resultKey = deleteOriginals ? 'moved' : 'results';
  const countKey = deleteOriginals ? 'moved' : 'copied';
  const failMsg = deleteOriginals ? 'move copy failed for key' : 'copy failed for key';

  if (!streamProgress) {
    const destinations = await computeDestinations(provider, sourceKeys, destinationPrefix);
    const succeeded: Array<{ sourceKey: string; destKey: string }> = [];
    const failed: Array<{ sourceKey: string; error: string }> = [];

    for (const { sourceKey, baseDestKey } of destinations) {
      try {
        const destKey = await uniqueDestKey(provider, baseDestKey);
        await provider.copyObject(sourceKey, destKey);
        succeeded.push({ sourceKey, destKey });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ sourceKey, error: message });
        logger.warn(
          { bucket, source_key: sourceKey, dest_key: baseDestKey, error: message },
          failMsg
        );
      }
    }

    if (deleteOriginals) {
      const keysToDelete = [...new Set(succeeded.map((s) => s.sourceKey))];
      if (keysToDelete.length > 0) {
        const deleteResult = await provider.deleteObjects(keysToDelete);
        for (const f of deleteResult.failed) {
          failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
          logger.warn({ bucket, key: f.key }, 'move delete failed for key');
        }
      }
    }

    logger.info(
      { bucket, [countKey]: succeeded.length, failed: failed.length },
      `${operationName} completed`
    );
    return json({ [resultKey]: succeeded, failed });
  }

  if (jobId) {
    createJob(jobId);
  }

  const buildCompletePayload = deleteOriginals
    ? (result: StreamableOpResult) => ({
        type: 'complete' as const,
        moved: result.results,
        failed: result.failed
      })
    : undefined;

  return createProgressStream(
    (emit) => {
      const run = async () => {
        const destinations = await computeDestinations(provider, sourceKeys, destinationPrefix);
        const succeeded: Array<{ sourceKey: string; destKey: string }> = [];
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

            succeeded.push({ sourceKey, destKey });
            emit({ type: 'done', sourceKey, destKey });
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            const errorName = err instanceof Error ? err.constructor.name : typeof err;
            const stack =
              err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 3).join(' | ') : '';
            failed.push({ sourceKey, error: message });
            logger.warn(
              {
                bucket,
                source_key: sourceKey,
                dest_key: baseDestKey,
                error: message,
                error_name: errorName,
                stack
              },
              failMsg
            );
            emit({ type: 'failed', sourceKey, error: message });
          }
        }

        if (deleteOriginals) {
          const keysToDelete = [...new Set(succeeded.map((s) => s.sourceKey))];
          if (keysToDelete.length > 0) {
            emit({ type: 'status', message: `Deleting ${keysToDelete.length} original(s)` });
            const deleteResult = await provider.deleteObjects(keysToDelete);
            for (const f of deleteResult.failed) {
              failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
              logger.warn({ bucket, key: f.key }, 'move delete failed for key');
            }
          }
        }

        logger.info(
          { bucket, [countKey]: succeeded.length, failed: failed.length },
          `${operationName} completed`
        );

        return { results: succeeded, failed };
      };
      return run();
    },
    {
      jobId,
      operationName,
      logger,
      bucket,
      buildCompletePayload
    }
  );
}
