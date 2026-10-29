import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getProvider } from './utils.js';
import { withStorageHttpErrors } from './wrap-provider.js';
import { notConnected } from './not-connected.js';
import type { StorageProvider } from './provider.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';
import { StorageObjectKeySchema } from '$lib/storage/schemas.js';

export function requireBucket(event: RequestEvent): string {
  const bucket = event.url.searchParams.get('bucket')?.trim();
  if (!bucket) throw error(400, 'Missing required query parameter: bucket');
  return bucket;
}

/** The `key` query parameter, validated as an S3 object key. */
export function requireObjectKey(event: RequestEvent): string {
  const key = event.url.searchParams.get('key');
  if (!key) throw error(400, 'Missing required query parameter: key');
  const parsed = StorageObjectKeySchema.safeParse(key);
  if (!parsed.success) throw error(400, 'Invalid query parameter: key');
  return parsed.data;
}

export function requireConfig(event: RequestEvent) {
  const config = event.locals.storageConfig;
  if (!config) notConnected();
  return config;
}

/** The connection id is captured for a manifest, never its decrypted config. */
export function requireStorageConnectionId(event: RequestEvent): string {
  const connectionId = event.request.headers.get(STORAGE_CONNECTION_ID_HEADER);
  if (!connectionId) notConnected();
  return connectionId;
}

export function createStorageProvider(event: RequestEvent): {
  provider: StorageProvider;
  bucket: string;
} {
  const config = requireConfig(event);
  const bucket = requireBucket(event);
  return { provider: withStorageHttpErrors(getProvider(config, bucket)), bucket };
}

export function createStorageProviderForBucket(
  event: RequestEvent,
  bucket: string
): StorageProvider {
  return withStorageHttpErrors(getProvider(requireConfig(event), bucket));
}
