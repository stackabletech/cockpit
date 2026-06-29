import { getProvider } from './utils.js';
import type { S3ConnectionConfig } from './types.js';

export async function uploadObject(
  config: S3ConnectionConfig,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
  contentLength: number
): Promise<void> {
  const provider = getProvider(config, bucket);
  await provider.putObject(key, body, contentType, contentLength);
}
