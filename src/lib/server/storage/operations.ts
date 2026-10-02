import type { StorageProvider } from './provider.js';
import type pino from 'pino';

export interface DestEntry {
  sourceKey: string;
  baseDestKey: string;
}

export interface ProcessKeysOptions {
  onCopySuccess?: (sourceKey: string, destKey: string) => void | Promise<void>;
  onCopyProgress?: (
    sourceKey: string,
    destKey: string,
    loaded: number,
    total: number
  ) => void | Promise<void>;
  onCopyFailed?: (
    sourceKey: string,
    destKey: string,
    error: string,
    errorName?: string,
    stack?: string
  ) => void | Promise<void>;
  onBeforeDelete?: (keys: string[]) => void | Promise<void>;
  onDeleteFailed?: (key: string, error: string) => void | Promise<void>;
  logger?: pino.Logger;
  bucket?: string;
  destinationProvider?: StorageProvider;
  deleteOriginals?: boolean;
}

export interface ProcessKeysResult {
  succeeded: Array<{ sourceKey: string; destKey: string }>;
  failed: Array<{ sourceKey: string; error: string }>;
}

/**
 * Compute copy/move destinations for each source key, expanding directories
 * to their full recursive listing while preserving the relative path
 * structure under the destination prefix.
 */
export async function computeDestinations(
  provider: StorageProvider,
  sourceKeys: string[],
  destinationPrefix: string
): Promise<DestEntry[]> {
  const destinationGroups = await Promise.all(
    sourceKeys.map(async (key): Promise<DestEntry[]> => {
      const name = key.endsWith('/')
        ? key.split('/').filter(Boolean).pop() + '/'
        : key.split('/').pop();

      if (!key.endsWith('/')) {
        return [{ sourceKey: key, baseDestKey: destinationPrefix + name }];
      }
      const children = await provider.listAllKeys(key);
      return [
        { sourceKey: key, baseDestKey: destinationPrefix + name },
        ...children
          .filter((child) => child !== key)
          .map((child) => ({
            sourceKey: child,
            baseDestKey: destinationPrefix + name + child.slice(key.length)
          }))
      ];
    })
  );

  return destinationGroups.flat();
}

/**
 * Given a desired destination key, check if it already exists and generate
 * a unique name by appending ` (1)`, ` (2)`, etc. before the extension.
 * Returns the first key that does not exist.
 */
export async function uniqueDestKey(provider: StorageProvider, baseKey: string): Promise<string> {
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

/**
 * Process a list of source keys sequentially, copying each to a unique
 * destination under the given prefix. Handles unique-key resolution,
 * optional progress reporting, failure logging, and originals deletion.
 *
 * This is the shared core used by both the non-streaming and streaming
 * code paths in copy-move operations.
 */
export async function processKeysSequentially(
  provider: StorageProvider,
  sourceKeys: string[],
  destinationPrefix: string,
  options: ProcessKeysOptions = {},
  destinationKey?: string
): Promise<ProcessKeysResult> {
  const {
    onCopySuccess,
    onCopyProgress,
    onCopyFailed,
    onBeforeDelete,
    onDeleteFailed,
    logger,
    bucket,
    destinationProvider = provider,
    deleteOriginals
  } = options;

  const destinations = destinationKey
    ? [{ sourceKey: sourceKeys[0]!, baseDestKey: destinationKey }]
    : await computeDestinations(provider, sourceKeys, destinationPrefix);
  const succeeded: Array<{ sourceKey: string; destKey: string }> = [];
  const failed: Array<{ sourceKey: string; error: string }> = [];

  const operationName = deleteOriginals ? 'move' : 'copy';
  const countKey = deleteOriginals ? 'moved' : 'copied';
  const failMsg = deleteOriginals ? 'move copy failed for key' : 'copy failed for key';

  const resolvedDestinations: Array<DestEntry & { destKey: string }> = [];
  for (const { sourceKey, baseDestKey } of destinations) {
    if (destinationKey && (await destinationProvider.exists(baseDestKey))) {
      failed.push({ sourceKey, error: 'Destination already exists' });
      await onCopyFailed?.(sourceKey, baseDestKey, 'Destination already exists');
      continue;
    }
    resolvedDestinations.push({
      sourceKey,
      baseDestKey,
      destKey: destinationKey ? baseDestKey : await uniqueDestKey(destinationProvider, baseDestKey)
    });
  }

  await Promise.all(
    resolvedDestinations.map(async ({ sourceKey, baseDestKey, destKey }) => {
      try {
        if (destinationProvider === provider && onCopyProgress) {
          await provider.copyObject(sourceKey, destKey, (loaded, total) => {
            onCopyProgress(sourceKey, destKey, loaded, total);
          });
        } else {
          if (destinationProvider === provider) {
            await provider.copyObject(sourceKey, destKey);
          } else {
            const source = await provider.getObject(sourceKey);
            await destinationProvider.putObject(
              destKey,
              source.stream,
              source.contentType ?? 'application/octet-stream',
              source.contentLength
            );
            if (onCopyProgress && source.contentLength !== undefined) {
              await onCopyProgress(sourceKey, destKey, source.contentLength, source.contentLength);
            }
          }
        }
        succeeded.push({ sourceKey, destKey });
        await onCopySuccess?.(sourceKey, destKey);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const errorName = err instanceof Error ? err.constructor.name : typeof err;
        const stack =
          err instanceof Error ? (err.stack ?? '').split('\n').slice(0, 3).join(' | ') : '';
        failed.push({ sourceKey, error: message });
        if (logger) {
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
        }
        await onCopyFailed?.(sourceKey, baseDestKey, message, errorName, stack);
      }
    })
  );

  if (deleteOriginals && succeeded.length > 0) {
    // Directories are expanded before copying. Delete only members whose copy
    // succeeded so a failed member is never removed by prefix expansion.
    const keysToDelete = [
      ...new Set(succeeded.map((s) => s.sourceKey).filter((key) => !key.endsWith('/')))
    ];
    if (keysToDelete.length > 0) {
      await onBeforeDelete?.(keysToDelete);
      const deleteResult = await provider.deleteObjects(keysToDelete);
      for (const f of deleteResult.failed) {
        failed.push({ sourceKey: f.key, error: f.message ?? 'Delete failed' });
        if (logger) {
          logger.warn({ bucket, key: f.key }, 'move delete failed for key');
        }
        await onDeleteFailed?.(f.key, f.message ?? 'Delete failed');
      }
    }
  }

  if (logger) {
    logger.info(
      { bucket, [countKey]: succeeded.length, failed: failed.length },
      `${operationName} completed`
    );
  }

  return { succeeded, failed };
}

/**
 * Encode a value as a single NDJSON line (newline-delimited JSON).
 */
export function ndjsonLine(data: Record<string, unknown>): string {
  return JSON.stringify(data) + '\n';
}
