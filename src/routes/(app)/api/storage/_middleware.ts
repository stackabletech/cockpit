import { error, isHttpError } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getProvider } from '$lib/server/storage/utils.js';
import type { StorageProvider } from '$lib/server/storage/provider.js';

export type StorageParams = {
  bucket: string;
  key?: string;
  prefix?: string;
  keys: string[];
  continuationToken?: string | null;
  pageSize: number;
  streamProgress: boolean;
  contentType?: string;
  originalSize?: number;
  previewBytes?: number;
  newKey?: string;
};

function wrapProvider(raw: StorageProvider): StorageProvider {
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            const result = value.apply(target, args);
            if (result instanceof Promise) {
              return result.catch((err: unknown) => {
                // If it's already an SvelteKit HTTP error, re-throw it as-is
                if (isHttpError(err)) throw err;
                throw error(502, err instanceof Error ? err.message : 'Storage provider error');
              });
            }
            return result;
          } catch (err) {
            // If it's already an SvelteKit HTTP error, re-throw it as-is
            if (isHttpError(err)) throw err;
            throw error(502, err instanceof Error ? err.message : 'Storage provider error');
          }
        };
      }
      return value;
    }
  });
}

export async function withStorage(event: RequestEvent): Promise<{
  provider: StorageProvider;
  params: StorageParams;
}> {
  const config = event.locals.storageConfig;
  if (!config) {
    throw error(401, 'No storage connection configured');
  }

  const url = event.url;
  const bucket = url.searchParams.get('bucket')?.trim();
  if (!bucket) {
    throw error(400, 'Missing required query parameter: bucket');
  }

  const rawPageSize = url.searchParams.get('pageSize');
  const rawOriginalSize = url.searchParams.get('originalSize');
  const rawPreviewBytes = url.searchParams.get('previewBytes');

  const params: StorageParams = {
    bucket,
    key: url.searchParams.get('key')?.trim() || undefined,
    prefix: url.searchParams.get('prefix')?.trim() ?? undefined,
    keys: url.searchParams.getAll('keys'),
    continuationToken: url.searchParams.get('continuationToken') || undefined,
    pageSize: rawPageSize ? parseInt(rawPageSize, 10) : 25,
    streamProgress: url.searchParams.get('progress') === 'true',
    contentType: url.searchParams.get('contentType')?.trim() || undefined,
    originalSize: rawOriginalSize ? parseInt(rawOriginalSize, 10) : undefined,
    previewBytes: rawPreviewBytes ? parseInt(rawPreviewBytes, 10) : undefined,
    newKey: undefined
  };

  const provider = wrapProvider(getProvider(config, bucket));

  return { provider, params };
}
