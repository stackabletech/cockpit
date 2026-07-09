import { S3Client } from '@aws-sdk/client-s3';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { Agent } from 'https';
import type { S3ConnectionConfig } from './types.js';

function buildEndpointUrl(config: S3ConnectionConfig): string {
  const scheme = config.tls ? 'https' : 'http';
  const portSuffix = config.port ? `:${config.port}` : '';
  return `${scheme}://${config.host}${portSuffix}`;
}

export function createS3Client(config: S3ConnectionConfig): S3Client {
  return new S3Client({
    region: config.region.name,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    endpoint: buildEndpointUrl(config),
    forcePathStyle: config.accessStyle === 'Path',
    ...(config.tls?.verification === 'None' && {
      requestHandler: new NodeHttpHandler({
        httpsAgent: new Agent({ rejectUnauthorized: false })
      })
    }),
    ...(config.credentials && {
      credentials: {
        accessKeyId: config.credentials.accessKey,
        secretAccessKey: config.credentials.secretKey
      }
    })
  });
}
