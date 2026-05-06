import type { StorageProvider } from './provider.js';
import type { StorageConfig } from './types.js';
import { S3StorageProvider } from './s3-provider.js';
import { HDFSStorageProvider } from './hdfs-provider.js';

export class StorageProviderFactory {
  static create(config: StorageConfig): StorageProvider {
    switch (config.type) {
      case 's3':
        return new S3StorageProvider(config);
      case 'hdfs':
        return new HDFSStorageProvider(config);
    }
  }
}
