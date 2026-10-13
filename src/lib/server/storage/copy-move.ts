import type { StorageProvider } from './provider.js';
import type pino from 'pino';
import { error, json } from '@sveltejs/kit';
import { processKeysSequentially } from './operations.js';
import { createProgressStream, type StreamableOpResult } from './streaming.js';
import { createJob } from './job-store.js';

export interface PerformCopyOrMoveOptions {
  provider: StorageProvider;
  destinationProvider?: StorageProvider;
  sourceKeys: string[];
  destinationPrefix: string;
  destinationKey?: string;
  streamProgress: boolean;
  logger: pino.Logger;
  bucket: string;
  jobId?: string;
  userId: string;
  deleteOriginals: boolean;
}

export async function performCopyOrMove(options: PerformCopyOrMoveOptions): Promise<Response> {
  const {
    provider,
    destinationProvider,
    sourceKeys,
    destinationPrefix,
    destinationKey,
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
      { logger, bucket, destinationProvider, deleteOriginals },
      destinationKey
    );
    // An explicit destination key is a single-item rename. Report a refused
    // rename as an HTTP error so callers cannot mistake it for success.
    if (destinationKey && succeeded.length === 0 && failed.length > 0) {
      const reason = failed[0].error;
      const status =
        reason === 'Destination already exists'
          ? 409
          : reason === 'Source and destination are the same'
            ? 400
            : 500;
      const level = status === 500 ? 'warn' : 'info';
      logger[level](
        { bucket, destination_key: destinationKey, failed: failed.length, status_code: status },
        `${operationName} to explicit destination refused`
      );
      throw error(status, reason);
    }
    return json({ [resultKey]: succeeded, failed });
  }

  // Streaming has already answered 200, so a refused `destinationKey` arrives as a per-item
  // `failed` event instead of an HTTP error. Callers must check the failures.
  if (jobId) {
    createJob(jobId, options.userId);
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
      const result = await processKeysSequentially(
        provider,
        sourceKeys,
        destinationPrefix,
        {
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
          destinationProvider,
          deleteOriginals
        },
        destinationKey
      );
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
