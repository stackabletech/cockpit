import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getProvider } from './utils.js';
import { wrapProvider } from './wrap-provider.js';
import type { StorageProvider } from './provider.js';

export function requireBucket(event: RequestEvent): string {
  const bucket = event.url.searchParams.get('bucket')?.trim();
  if (!bucket) throw error(400, 'Missing required query parameter: bucket');
  return bucket;
}

export function requireConfig(event: RequestEvent) {
  const config = event.locals.storageConfig;
  if (!config) throw error(401, 'No storage connection configured');
  return config;
}

export function createStorageProvider(event: RequestEvent): {
  provider: StorageProvider;
  bucket: string;
} {
  const config = requireConfig(event);
  const bucket = requireBucket(event);
  return { provider: wrapProvider(getProvider(config, bucket)), bucket };
}
