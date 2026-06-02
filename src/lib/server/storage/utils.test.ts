import { describe, it, expect, vi } from 'vitest';
import { faker } from '@faker-js/faker';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn() }) }
}));

const mockGetUserConnection = vi.fn();
vi.mock('./user-connections.js', () => ({
  getUserConnection: (...args: unknown[]) => mockGetUserConnection(...args)
}));

const mockCreate = vi.fn().mockReturnValue({ listObjects: vi.fn() });
vi.mock('./factory.js', () => ({
  StorageProviderFactory: { create: (...args: unknown[]) => mockCreate(...args) }
}));

import { getProviderForUser } from './utils.js';

describe('getProviderForUser', () => {
  it('throws 401 when no connection exists', () => {
    mockGetUserConnection.mockReturnValue(null);
    expect(() => getProviderForUser(faker.string.uuid(), 'bucket')).toThrow(
      expect.objectContaining({ status: 401 })
    );
  });

  it('throws 400 for non-s3 connection type', () => {
    mockGetUserConnection.mockReturnValue({ type: 'hdfs', nameNode: 'nn', port: 9870, user: 'u' });
    expect(() => getProviderForUser(faker.string.uuid(), 'bucket')).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns provider for valid s3 connection', () => {
    const config = { type: 's3', region: 'us-east-1' };
    mockGetUserConnection.mockReturnValue(config);
    const provider = getProviderForUser('user1', 'my-bucket');
    expect(mockCreate).toHaveBeenCalledWith({ ...config, bucket: 'my-bucket' });
    expect(provider).toBeDefined();
  });
});
