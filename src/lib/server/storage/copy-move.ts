import type { StorageProvider } from './provider.js';
import type pino from 'pino';
import { json } from '@sveltejs/kit';
import { processKeysSequentially } from './operations.js';
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

  if (!streamProgress) {
    const { succeeded, failed } = await processKeysSequentially(
      provider,
      sourceKeys,
      destinationPrefix,
      { logger, bucket, deleteOriginals }
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
    async (emit) => {
      const progressReported = new Set<string>();
      const result = await processKeysSequentially(provider, sourceKeys, destinationPrefix, {
        onCopyProgress: (sourceKey, destKey, loaded, total) => {
          progressReported.add(sourceKey);
          emit({ type: 'progress', sourceKey, destKey, loaded, total });
        },
        onCopySuccess: async (sourceKey, destKey) => {
          if (!progressReported.has(sourceKey)) {
            try {
              const meta = await provider.getMetadata(sourceKey);
              emit({ type: 'progress', sourceKey, destKey, loaded: meta.size, total: meta.size });
            } catch {
              // Metadata fetch failed — skip synthetic progress
            }
          }
          progressReported.delete(sourceKey);
          emit({ type: 'done', sourceKey, destKey });
        },
        onCopyFailed: (sourceKey, destKey, error) => {
          emit({ type: 'failed', sourceKey, error });
        },
        onBeforeDelete: (keys) => {
          emit({ type: 'status', message: `Deleting ${keys.length} original(s)` });
        },
        logger,
        bucket,
        deleteOriginals
      });
      return { results: result.succeeded, failed: result.failed };
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
