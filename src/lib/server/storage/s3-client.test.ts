import { describe, it, expect, vi } from 'vitest';
import type { S3ConnectionConfig } from './types.js';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn()
}));

vi.mock('@smithy/node-http-handler', () => ({
  NodeHttpHandler: vi.fn()
}));

import { createS3Client } from './s3-client.js';
import { S3Client } from '@aws-sdk/client-s3';
const mockS3Client = vi.mocked(S3Client);

function baseConfig(overrides: Partial<S3ConnectionConfig> = {}): S3ConnectionConfig {
  return {
    type: 's3',
    host: 'minio.example.com',
    accessStyle: 'Path',
    region: { name: 'us-east-1' },
    ...overrides
  };
}

describe('createS3Client', () => {
  it('builds an http endpoint when tls is absent', () => {
    createS3Client(baseConfig({ tls: undefined }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://minio.example.com' })
    );
  });

  it('builds an https endpoint when tls is present', () => {
    createS3Client(baseConfig({ tls: { verification: 'Full' } }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'https://minio.example.com' })
    );
  });

  it('includes port in the endpoint URL when port is set', () => {
    createS3Client(baseConfig({ port: 9000, tls: undefined }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: 'http://minio.example.com:9000' })
    );
  });

  it('sets forcePathStyle=true for Path access style', () => {
    createS3Client(baseConfig({ accessStyle: 'Path' }));
    expect(mockS3Client).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: true }));
  });

  it('sets forcePathStyle=false for VirtualHosted access style', () => {
    createS3Client(baseConfig({ accessStyle: 'VirtualHosted' }));
    expect(mockS3Client).toHaveBeenCalledWith(expect.objectContaining({ forcePathStyle: false }));
  });

  it('passes region name to the SDK', () => {
    createS3Client(baseConfig({ region: { name: 'eu-west-1' } }));
    expect(mockS3Client).toHaveBeenCalledWith(expect.objectContaining({ region: 'eu-west-1' }));
  });

  it('sets credentials when accessKey and secretKey are provided', () => {
    createS3Client(baseConfig({ credentials: { accessKey: 'AKID', secretKey: 'SECRET' } }));
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' },
        requestChecksumCalculation: 'WHEN_REQUIRED'
      })
    );
  });

  it('does not set credentials when credentials is absent', () => {
    createS3Client(baseConfig({ credentials: undefined }));
    const call = mockS3Client.mock.calls.at(-1)![0] as { credentials?: unknown };
    expect(call.credentials).toBeUndefined();
  });
});
