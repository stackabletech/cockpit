import { describe, it, expect, vi } from 'vitest';
import { faker } from '@faker-js/faker';

vi.mock('./s3-provider.js', () => ({
  S3StorageProvider: class S3StorageProvider {
    constructor(public config: unknown) {}
  }
}));

vi.mock('./hdfs-provider.js', () => ({
  HDFSStorageProvider: class HDFSStorageProvider {
    constructor(public config: unknown) {}
  }
}));

import { StorageProviderFactory } from './factory.js';
import type { S3Config, HDFSConfig } from './types.js';

describe('StorageProviderFactory', () => {
  it('creates S3StorageProvider for type s3', () => {
    const config: S3Config = { type: 's3', region: 'us-east-1', bucket: 'test' };
    const provider = StorageProviderFactory.create(config);
    expect((provider as any).config).toEqual(config);
  });

  it('creates HDFSStorageProvider for type hdfs', () => {
    const config: HDFSConfig = {
      type: 'hdfs',
      nameNode: faker.internet.url(),
      port: 9870,
      user: faker.internet.username()
    };
    const provider = StorageProviderFactory.create(config);
    expect((provider as any).config).toEqual(config);
  });
});
