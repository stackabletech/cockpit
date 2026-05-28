import { describe, it, expect, vi } from 'vitest';
import { faker } from '@faker-js/faker';
import type { S3ConnectionConfig } from './types.js';

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn()
}));

import { createS3Client } from './s3-client.js';
import { S3Client } from '@aws-sdk/client-s3';
const mockS3Client = vi.mocked(S3Client);

describe('createS3Client', () => {
  it('creates client with region only (no endpoint, no credentials)', () => {
    const config: S3ConnectionConfig = { type: 's3', region: 'us-east-1' };
    createS3Client(config);
    expect(mockS3Client).toHaveBeenCalledWith({ region: 'us-east-1' });
  });

  it('sets endpoint and forcePathStyle when endpoint provided', () => {
    const endpoint = faker.internet.url();
    const config: S3ConnectionConfig = { type: 's3', region: 'eu-west-1', endpoint };
    createS3Client(config);
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint, forcePathStyle: true })
    );
  });

  it('respects pathStyle=false', () => {
    const endpoint = faker.internet.url();
    const config: S3ConnectionConfig = {
      type: 's3',
      region: 'eu-west-1',
      endpoint,
      pathStyle: false
    };
    createS3Client(config);
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint, forcePathStyle: false })
    );
  });

  it('sets credentials when accessKeyId and secretAccessKey provided', () => {
    const config: S3ConnectionConfig = {
      type: 's3',
      region: 'us-west-2',
      accessKeyId: 'AKID',
      secretAccessKey: 'SECRET'
    };
    createS3Client(config);
    expect(mockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: { accessKeyId: 'AKID', secretAccessKey: 'SECRET' }
      })
    );
  });

  it('does not set credentials when only accessKeyId provided', () => {
    const config: S3ConnectionConfig = { type: 's3', region: 'us-west-2', accessKeyId: 'AKID' };
    createS3Client(config);
    const call = mockS3Client.mock.calls[mockS3Client.mock.calls.length - 1][0];
    expect(call.credentials).toBeUndefined();
  });
});
