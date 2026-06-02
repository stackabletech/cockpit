import { describe, it, expect } from 'vitest';
import { HDFSStorageProvider } from './hdfs-provider.js';
import type { HDFSConfig } from './types.js';

const config: HDFSConfig = {
  type: 'hdfs',
  nameNode: 'hdfs://namenode.example.com',
  port: 9870,
  user: 'testuser'
};

/** All methods throw synchronously (stub implementation). */
function expectThrows(fn: () => unknown) {
  expect(fn).toThrow('HDFS not implemented');
}

describe('HDFSStorageProvider', () => {
  it('constructs without throwing', () => {
    expect(() => new HDFSStorageProvider(config)).not.toThrow();
  });

  describe('listObjects', () => {
    it('throws "HDFS not implemented"', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.listObjects('prefix/', 100));
    });

    it('throws with continuation token', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.listObjects('prefix/', 10, 'token'));
    });

    it('throws with null continuation token', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.listObjects('', 50, null));
    });
  });

  describe('getObject', () => {
    it('throws "HDFS not implemented"', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.getObject('some/key.txt'));
    });
  });

  describe('getObjectRange', () => {
    it('throws "HDFS not implemented"', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.getObjectRange('some/key.txt', 0, 1023));
    });
  });

  describe('getMetadata', () => {
    it('throws "HDFS not implemented"', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.getMetadata('some/key.txt'));
    });
  });

  describe('exists', () => {
    it('throws "HDFS not implemented"', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.exists('some/key.txt'));
    });
  });

  describe('putObject', () => {
    it('throws "HDFS not implemented" with Buffer body', () => {
      const provider = new HDFSStorageProvider(config);
      const body = Buffer.from('hello');
      expectThrows(() => provider.putObject('some/key.txt', body, 'text/plain', 5));
    });

    it('throws "HDFS not implemented" without contentLength', () => {
      const provider = new HDFSStorageProvider(config);
      const body = Buffer.from('hello');
      expectThrows(() => provider.putObject('some/key.txt', body, 'text/plain'));
    });
  });

  describe('deleteObjects', () => {
    it('throws "HDFS not implemented"', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.deleteObjects(['key1', 'key2']));
    });

    it('throws with empty array', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.deleteObjects([]));
    });
  });

  describe('listAllKeys', () => {
    it('throws "HDFS not implemented"', () => {
      const provider = new HDFSStorageProvider(config);
      expectThrows(() => provider.listAllKeys('prefix/'));
    });
  });
});
