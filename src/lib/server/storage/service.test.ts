import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn() }) }
}));

const mockGetUserConnection = vi.fn();
const mockSetUserConnection = vi.fn();
const mockClearUserConnection = vi.fn();
vi.mock('./user-connections.js', () => ({
  getUserConnection: (...args: unknown[]) => mockGetUserConnection(...args),
  setUserConnection: (...args: unknown[]) => mockSetUserConnection(...args),
  clearUserConnection: (...args: unknown[]) => mockClearUserConnection(...args)
}));

const mockSend = vi.fn();
vi.mock('./s3-client.js', () => ({
  createS3Client: () => ({ send: (...args: unknown[]) => mockSend(...args) })
}));

const mockProvider = {
  listObjects: vi.fn(),
  getObject: vi.fn(),
  getObjectRange: vi.fn(),
  getMetadata: vi.fn(),
  exists: vi.fn(),
  putObject: vi.fn(),
  deleteObjects: vi.fn(),
  listAllKeys: vi.fn()
};
vi.mock('./utils.js', () => ({
  getProviderForUser: () => mockProvider
}));

vi.mock('./s3-errors.js', () => ({
  mapS3ErrorToHttp: (err: unknown) => {
    throw err;
  }
}));

import {
  listBuckets,
  listObjects,
  downloadObject,
  getObjectMetadata,
  uploadObject,
  deleteObjects
} from './service.js';

describe('storage service', () => {
  const userId = faker.string.uuid();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listBuckets', () => {
    it('returns empty array when no connection', async () => {
      mockGetUserConnection.mockReturnValue(null);
      expect(await listBuckets(userId)).toEqual([]);
    });

    it('returns bucket names', async () => {
      mockGetUserConnection.mockReturnValue({ type: 's3', region: 'us-east-1' });
      mockSend.mockResolvedValue({ Buckets: [{ Name: 'a' }, { Name: 'b' }] });
      expect(await listBuckets(userId)).toEqual(['a', 'b']);
    });
  });

  describe('listObjects', () => {
    it('proxies to provider', async () => {
      const page = { objects: [], prefixes: [], nextToken: null };
      mockProvider.listObjects.mockResolvedValue(page);
      const result = await listObjects(userId, 'bucket', 'prefix/', 100);
      expect(mockProvider.listObjects).toHaveBeenCalledWith('prefix/', 100, undefined);
      expect(result).toEqual(page);
    });
  });

  describe('downloadObject', () => {
    it('returns download from provider', async () => {
      const download = { stream: new ReadableStream(), contentType: 'text/plain' };
      mockProvider.getObject.mockResolvedValue(download);
      const result = await downloadObject(userId, 'bucket', 'key.txt');
      expect(result).toEqual(download);
    });
  });

  describe('getObjectMetadata', () => {
    it('proxies to provider', async () => {
      const meta = { contentType: 'text/plain', contentLength: 42 };
      mockProvider.getMetadata.mockResolvedValue(meta);
      expect(await getObjectMetadata(userId, 'bucket', 'k')).toEqual(meta);
    });
  });

  describe('uploadObject', () => {
    it('proxies to provider', async () => {
      mockProvider.putObject.mockResolvedValue(undefined);
      await uploadObject(userId, 'bucket', 'k', Buffer.from('x'), 'text/plain', 1);
      expect(mockProvider.putObject).toHaveBeenCalledWith('k', expect.any(Buffer), 'text/plain', 1);
    });
  });

  describe('deleteObjects', () => {
    it('expands directory prefixes and deletes all', async () => {
      mockProvider.listAllKeys.mockResolvedValue(['dir/a.txt', 'dir/b.txt']);
      mockProvider.deleteObjects.mockResolvedValue({ failed: [] });
      const result = await deleteObjects(userId, 'bucket', ['file.txt', 'dir/']);
      expect(mockProvider.listAllKeys).toHaveBeenCalledWith('dir/');
      expect(mockProvider.deleteObjects).toHaveBeenCalledWith([
        'file.txt',
        'dir/a.txt',
        'dir/b.txt'
      ]);
      expect(result).toEqual({ failed: [] });
    });

    it('uses directory key itself when no children found', async () => {
      mockProvider.listAllKeys.mockResolvedValue([]);
      mockProvider.deleteObjects.mockResolvedValue({ failed: [] });
      await deleteObjects(userId, 'bucket', ['empty/']);
      expect(mockProvider.deleteObjects).toHaveBeenCalledWith(['empty/']);
    });

    it('returns empty result for no keys', async () => {
      // No file keys, no dir prefixes after expansion
      mockProvider.listAllKeys.mockResolvedValue([]);
      mockProvider.deleteObjects.mockResolvedValue({ failed: [] });
      const result = await deleteObjects(userId, 'bucket', []);
      expect(result).toEqual({ failed: [] });
    });
  });
});
