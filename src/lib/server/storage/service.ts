import { getProvider } from './utils.js';
import type { ObjectDownload } from './provider.js';
import type { StorageMetadata } from '$lib/storage/types.js';
import type { S3ConnectionConfig, StorageConfig } from './types.js';

export async function uploadObject(
  config: StorageConfig | S3ConnectionConfig,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  contentLength: number
): Promise<void> {
  const provider = getProvider(config, bucket);
  await provider.putObject(key, body, contentType, contentLength);
}

export async function downloadObject(
  config: StorageConfig | S3ConnectionConfig,
  bucket: string,
  key: string
): Promise<ObjectDownload> {
  const provider = getProvider(config, bucket);
  return provider.getObject(key);
}

export async function getObjectMetadata(
  config: StorageConfig | S3ConnectionConfig,
  bucket: string,
  key: string
): Promise<StorageMetadata> {
  const provider = getProvider(config, bucket);
  return provider.getMetadata(key);
}
