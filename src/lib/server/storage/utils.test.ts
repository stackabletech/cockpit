import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn() }) }
}));

const mockCreate = vi.fn().mockReturnValue({ listObjects: vi.fn() });
vi.mock('./factory.js', () => ({
  StorageProviderFactory: { create: (...args: unknown[]) => mockCreate(...args) }
}));

import { getProvider } from './utils.js';
import type { S3ConnectionConfig } from './types.js';

const s3Config: S3ConnectionConfig = {
  type: 's3',
  host: 'minio.example.com',
  accessStyle: 'Path',
  region: { name: 'us-east-1' }
};

describe('getProvider', () => {
  it('throws 400 for non-s3 connection type', () => {
    expect(() =>
      getProvider({ type: 'hdfs', nameNode: 'nn', port: 9870, user: 'u' } as never, 'bucket')
    ).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('returns provider for valid s3 connection', () => {
    const provider = getProvider(s3Config, 'my-bucket');
    expect(mockCreate).toHaveBeenCalledWith({ ...s3Config, bucket: 'my-bucket' });
    expect(provider).toBeDefined();
  });
});
