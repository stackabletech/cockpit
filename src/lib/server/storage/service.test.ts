import { describe, it, expect, vi, beforeEach } from 'vitest';
import { faker } from '@faker-js/faker';
import { S3ServiceException } from '@aws-sdk/client-s3';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn() }) }
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
  getProvider: () => mockProvider
}));

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const mockMapS3ErrorToHttp = vi.fn((err: unknown, _context?: unknown) => {
  throw err;
});
vi.mock('./s3-errors.js', () => ({
  mapS3ErrorToHttp: (err: unknown, context: unknown) => mockMapS3ErrorToHttp(err, context)
}));

function makeS3Error(name = 'NoSuchKey'): S3ServiceException {
  return new S3ServiceException({ name, message: name, $fault: 'client', $metadata: {} });
}

import {
  listBuckets,
  listObjects,
  downloadObject,
  getObjectMetadata,
  uploadObject,
  deleteObjects
} from './service.js';
import type { S3ConnectionConfig } from './types.js';

const config: S3ConnectionConfig = {
  type: 's3',
  region: faker.location.countryCode()
};

describe('storage service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listBuckets', () => {
    it('returns bucket names', async () => {
      mockSend.mockResolvedValue({ Buckets: [{ Name: 'a' }, { Name: 'b' }] });
      expect(await listBuckets(config)).toEqual(['a', 'b']);
    });

    it('filters out buckets with no name', async () => {
      mockSend.mockResolvedValue({ Buckets: [{ Name: 'a' }, { Name: undefined }, { Name: '' }] });
      expect(await listBuckets(config)).toEqual(['a']);
    });

    it('handles null Buckets in response', async () => {
      mockSend.mockResolvedValue({ Buckets: null });
      expect(await listBuckets(config)).toEqual([]);
    });
  });

  describe('listObjects', () => {
    it('proxies to provider', async () => {
      const page = { objects: [], prefixes: [], nextToken: null };
      mockProvider.listObjects.mockResolvedValue(page);
      const result = await listObjects(config, 'bucket', 'prefix/', 100);
      expect(mockProvider.listObjects).toHaveBeenCalledWith('prefix/', 100, undefined);
      expect(result).toEqual(page);
    });

    it('passes continuation token when provided', async () => {
      const page = { objects: [], prefixes: [], nextToken: null };
      mockProvider.listObjects.mockResolvedValue(page);
      await listObjects(config, 'bucket', '', 10, 'tok');
      expect(mockProvider.listObjects).toHaveBeenCalledWith('', 10, 'tok');
    });

    it('passes undefined when continuation token is null', async () => {
      const page = { objects: [], prefixes: [], nextToken: null };
      mockProvider.listObjects.mockResolvedValue(page);
      await listObjects(config, 'bucket', '', 10, null);
      expect(mockProvider.listObjects).toHaveBeenCalledWith('', 10, undefined);
    });

    it('throws S3ServiceException via mapS3ErrorToHttp', async () => {
      const err = makeS3Error('AccessDenied');
      mockProvider.listObjects.mockRejectedValue(err);
      await expect(listObjects(config, 'bucket', '', 10)).rejects.toThrow(err);
      expect(mockMapS3ErrorToHttp).toHaveBeenCalledWith(err, {
        bucket: 'bucket',
        operation: 'listObjects'
      });
    });

    it('rethrows non-S3 errors', async () => {
      const err = new Error('network');
      mockProvider.listObjects.mockRejectedValue(err);
      await expect(listObjects(config, 'bucket', '', 10)).rejects.toThrow('network');
      expect(mockMapS3ErrorToHttp).not.toHaveBeenCalled();
    });
  });

  describe('downloadObject', () => {
    it('returns download from provider', async () => {
      const download = { stream: new ReadableStream(), contentType: 'text/plain' };
      mockProvider.getObject.mockResolvedValue(download);
      const result = await downloadObject(config, 'bucket', 'key.txt');
      expect(result).toEqual(download);
    });

    it('throws S3ServiceException via mapS3ErrorToHttp', async () => {
      const err = makeS3Error('NoSuchKey');
      mockProvider.getObject.mockRejectedValue(err);
      await expect(downloadObject(config, 'bucket', 'key.txt')).rejects.toThrow(err);
      expect(mockMapS3ErrorToHttp).toHaveBeenCalledWith(err, {
        bucket: 'bucket',
        key: 'key.txt',
        operation: 'getObject'
      });
    });

    it('rethrows non-S3 errors', async () => {
      const err = new Error('timeout');
      mockProvider.getObject.mockRejectedValue(err);
      await expect(downloadObject(config, 'bucket', 'k')).rejects.toThrow('timeout');
      expect(mockMapS3ErrorToHttp).not.toHaveBeenCalled();
    });
  });

  describe('getObjectMetadata', () => {
    it('proxies to provider', async () => {
      const meta = { contentType: 'text/plain', contentLength: 42 };
      mockProvider.getMetadata.mockResolvedValue(meta);
      expect(await getObjectMetadata(config, 'bucket', 'k')).toEqual(meta);
    });

    it('throws S3ServiceException via mapS3ErrorToHttp', async () => {
      const err = makeS3Error('NoSuchKey');
      mockProvider.getMetadata.mockRejectedValue(err);
      await expect(getObjectMetadata(config, 'bucket', 'k')).rejects.toThrow(err);
      expect(mockMapS3ErrorToHttp).toHaveBeenCalledWith(err, {
        bucket: 'bucket',
        key: 'k',
        operation: 'getMetadata'
      });
    });

    it('rethrows non-S3 errors', async () => {
      const err = new Error('gone');
      mockProvider.getMetadata.mockRejectedValue(err);
      await expect(getObjectMetadata(config, 'bucket', 'k')).rejects.toThrow('gone');
      expect(mockMapS3ErrorToHttp).not.toHaveBeenCalled();
    });
  });

  describe('uploadObject', () => {
    it('proxies to provider', async () => {
      mockProvider.putObject.mockResolvedValue(undefined);
      await uploadObject(config, 'bucket', 'k', Buffer.from('x'), 'text/plain', 1);
      expect(mockProvider.putObject).toHaveBeenCalledWith('k', expect.any(Buffer), 'text/plain', 1);
    });

    it('throws S3ServiceException via mapS3ErrorToHttp', async () => {
      const err = makeS3Error('AccessDenied');
      mockProvider.putObject.mockRejectedValue(err);
      await expect(
        uploadObject(config, 'bucket', 'k', Buffer.from('x'), 'text/plain')
      ).rejects.toThrow(err);
      expect(mockMapS3ErrorToHttp).toHaveBeenCalledWith(err, {
        bucket: 'bucket',
        key: 'k',
        operation: 'putObject'
      });
    });

    it('rethrows non-S3 errors', async () => {
      const err = new Error('disk full');
      mockProvider.putObject.mockRejectedValue(err);
      await expect(
        uploadObject(config, 'bucket', 'k', Buffer.from('x'), 'text/plain')
      ).rejects.toThrow('disk full');
      expect(mockMapS3ErrorToHttp).not.toHaveBeenCalled();
    });
  });

  describe('deleteObjects', () => {
    it('expands directory prefixes and deletes all', async () => {
      mockProvider.listAllKeys.mockResolvedValue(['dir/a.txt', 'dir/b.txt']);
      mockProvider.deleteObjects.mockResolvedValue({ failed: [] });
      const result = await deleteObjects(config, 'bucket', ['file.txt', 'dir/']);
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
      await deleteObjects(config, 'bucket', ['empty/']);
      expect(mockProvider.deleteObjects).toHaveBeenCalledWith(['empty/']);
    });

    it('returns empty result for no keys', async () => {
      mockProvider.listAllKeys.mockResolvedValue([]);
      mockProvider.deleteObjects.mockResolvedValue({ failed: [] });
      const result = await deleteObjects(config, 'bucket', []);
      expect(result).toEqual({ failed: [] });
    });

    it('throws S3ServiceException via mapS3ErrorToHttp', async () => {
      const err = makeS3Error('AccessDenied');
      mockProvider.listAllKeys.mockResolvedValue([]);
      mockProvider.deleteObjects.mockRejectedValue(err);
      await expect(deleteObjects(config, 'bucket', ['file.txt'])).rejects.toThrow(err);
      expect(mockMapS3ErrorToHttp).toHaveBeenCalledWith(err, {
        bucket: 'bucket',
        operation: 'deleteObjects'
      });
    });

    it('rethrows non-S3 errors', async () => {
      const err = new Error('network');
      mockProvider.deleteObjects.mockRejectedValue(err);
      await expect(deleteObjects(config, 'bucket', ['file.txt'])).rejects.toThrow('network');
      expect(mockMapS3ErrorToHttp).not.toHaveBeenCalled();
    });
  });
});
