import type { StorageObject, StoragePage } from './types.js';

export function makeObjects(): StorageObject[] {
  return [
    {
      key: 'file.txt',
      size: 100,
      lastModified: new Date('2025-01-01'),
      isDirectory: false,
      contentType: 'text/plain'
    },
    {
      key: 'dir/',
      size: 0,
      lastModified: new Date('2025-01-01'),
      isDirectory: true,
      contentType: undefined
    },
    {
      key: 'photo.jpg',
      size: 500,
      lastModified: new Date('2025-01-01'),
      isDirectory: false,
      contentType: 'image/jpeg'
    },
    {
      key: 'nested/file.js',
      size: 200,
      lastModified: new Date('2025-01-01'),
      isDirectory: false,
      contentType: 'application/javascript'
    }
  ];
}

export function makePage(objects?: StorageObject[]): StoragePage {
  return {
    objects: objects ?? makeObjects(),
    hasNextPage: false,
    currentPage: 1,
    pageSize: 25
  };
}
