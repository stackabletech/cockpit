import { S3Client } from '@aws-sdk/client-s3';
import type { S3ConnectionConfig } from './types.js';

export function createS3Client(config: S3ConnectionConfig): S3Client {
  return new S3Client({
    region: config.region,
    ...(config.endpoint && {
      endpoint: config.endpoint,
      forcePathStyle: true
    }),
    ...(config.accessKeyId &&
      config.secretAccessKey && {
        credentials: {
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey
        }
      })
  });
}
