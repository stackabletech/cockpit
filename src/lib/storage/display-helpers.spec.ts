import { describe, it, expect, vi } from 'vitest';
import {
  storageHref,
  pinnedLabel,
  pinnedHref,
  fileName,
  fileLocation,
  fileHref,
  locationName,
  locationPath,
  locationHref,
  encodeContainerSegment,
  decodeContainerSegment,
  objectUri
} from './display-helpers.js';
import type { PinnedLocation, RecentFile, RecentLocation } from './types.js';

vi.mock('$app/paths', () => ({
  resolve: (_route: string, params: Record<string, string>) => {
    const connection = params.connection ?? '';
    const bucket = params.bucket ?? '';
    const prefix = params.prefix ?? '';
    return `/storage/browse/${connection}/${bucket}${prefix ? '/' + prefix : ''}` as never;
  }
}));

describe('storageHref', () => {
  it('generates href for bucket root', () => {
    expect(storageHref('s3.example.com', 'my-bucket', '')).toBe(
      '/storage/browse/s3.example.com/my-bucket'
    );
  });

  it('generates href with prefix', () => {
    expect(storageHref('s3.example.com', 'my-bucket', 'some/path')).toBe(
      '/storage/browse/s3.example.com/my-bucket/some/path'
    );
  });

  it('encodes special characters in bucket', () => {
    expect(storageHref('s3.example.com', 'my bucket', '')).toBe(
      '/storage/browse/s3.example.com/my%20bucket'
    );
  });

  it('encodes special characters in prefix segments', () => {
    expect(storageHref('s3.example.com', 'bucket', 'path/with spaces/file.txt')).toBe(
      '/storage/browse/s3.example.com/bucket/path/with%20spaces/file.txt'
    );
  });
});

describe('pinnedLabel', () => {
  it('returns bucket name when no prefix', () => {
    const pin: PinnedLocation = { connectionId: 'c1', bucket: 'my-bucket', prefix: '' };
    expect(pinnedLabel(pin)).toBe('my-bucket');
  });

  it('returns last segment of prefix', () => {
    const pin: PinnedLocation = {
      connectionId: 'c1',
      bucket: 'my-bucket',
      prefix: 'a/b/deep-path'
    };
    expect(pinnedLabel(pin)).toBe('deep-path');
  });
});

describe('pinnedHref', () => {
  it('generates href from pinned location', () => {
    const pin: PinnedLocation = { connectionId: 'c1', bucket: 'my-bucket', prefix: 'some/path' };
    expect(pinnedHref('s3.example.com', pin)).toBe(
      '/storage/browse/s3.example.com/my-bucket/some/path'
    );
  });
});

describe('fileName', () => {
  it('extracts filename from key', () => {
    expect(fileName('path/to/file.txt')).toBe('file.txt');
  });

  it('handles root-level key', () => {
    expect(fileName('file.txt')).toBe('file.txt');
  });

  it('handles trailing slash', () => {
    expect(fileName('path/to/dir/')).toBe('dir');
  });
});

describe('fileLocation', () => {
  it('returns bucket name for root-level file', () => {
    const file: RecentFile = {
      key: 'file.txt',
      bucket: 'my-bucket',
      size: 100,
      visitedAt: '2024-01-01',
      connectionId: 'c1'
    };
    expect(fileLocation(file)).toBe('my-bucket');
  });

  it('returns bucket with path segments for nested file', () => {
    const file: RecentFile = {
      key: 'a/b/c/file.txt',
      bucket: 'my-bucket',
      size: 100,
      visitedAt: '2024-01-01',
      connectionId: 'c1'
    };
    expect(fileLocation(file)).toBe('my-bucket / a / b / c');
  });
});

describe('fileHref', () => {
  it('generates href to parent directory of the file', () => {
    const file: RecentFile = {
      key: 'a/b/file.txt',
      bucket: 'my-bucket',
      size: 100,
      visitedAt: '2024-01-01',
      connectionId: 'c1'
    };
    expect(fileHref('s3.example.com', file)).toBe('/storage/browse/s3.example.com/my-bucket/a/b');
  });

  it('generates href to bucket root for top-level file', () => {
    const file: RecentFile = {
      key: 'file.txt',
      bucket: 'my-bucket',
      size: 100,
      visitedAt: '2024-01-01',
      connectionId: 'c1'
    };
    expect(fileHref('s3.example.com', file)).toBe('/storage/browse/s3.example.com/my-bucket');
  });
});

describe('locationName', () => {
  it('returns bucket name when no prefix', () => {
    const loc: RecentLocation = {
      bucket: 'my-bucket',
      prefix: '',
      visitedAt: '',
      connectionId: 'c1'
    };
    expect(locationName(loc)).toBe('my-bucket');
  });

  it('returns last prefix segment', () => {
    const loc: RecentLocation = {
      bucket: 'my-bucket',
      prefix: 'a/b/c',
      visitedAt: '',
      connectionId: 'c1'
    };
    expect(locationName(loc)).toBe('c');
  });
});

describe('locationPath', () => {
  it('returns bucket name when no prefix', () => {
    const loc: RecentLocation = {
      bucket: 'my-bucket',
      prefix: '',
      visitedAt: '',
      connectionId: 'c1'
    };
    expect(locationPath(loc)).toBe('my-bucket');
  });

  it('returns bucket / prefix path', () => {
    const loc: RecentLocation = {
      bucket: 'my-bucket',
      prefix: 'a/b/c',
      visitedAt: '',
      connectionId: 'c1'
    };
    expect(locationPath(loc)).toBe('my-bucket / a / b / c');
  });
});

describe('locationHref', () => {
  it('generates href from recent location', () => {
    const loc: RecentLocation = {
      bucket: 'my-bucket',
      prefix: 'some/path',
      visitedAt: '',
      connectionId: 'c1'
    };
    expect(locationHref('s3.example.com', loc)).toBe(
      '/storage/browse/s3.example.com/my-bucket/some/path'
    );
  });
});

describe('container segment encoding', () => {
  it('leaves S3 bucket names readable', () => {
    expect(encodeContainerSegment('my-bucket')).toBe('my-bucket');
    expect(decodeContainerSegment('my-bucket')).toBe('my-bucket');
  });

  it.each(['/', '/user/alice', '/data', '/daten/übersicht', '/a b/~x'])(
    'round-trips HDFS base path %s without slashes or percent-encoding',
    (path) => {
      const segment = encodeContainerSegment(path);
      expect(segment.startsWith('~')).toBe(true);
      expect(segment).toMatch(/^~[A-Za-z0-9_-]*$/);
      expect(decodeContainerSegment(segment)).toBe(path);
    }
  );

  it('encodes the HDFS root as a bare ~', () => {
    expect(encodeContainerSegment('/')).toBe('~');
  });

  it('builds browse hrefs for HDFS base paths', () => {
    expect(storageHref('nn', '/user/alice', 'logs/')).toBe(
      `/storage/browse/nn/${encodeContainerSegment('/user/alice')}/logs`
    );
  });
});

describe('objectUri', () => {
  it('formats S3 and HDFS object locations', () => {
    expect(objectUri('my-bucket', 'a/b.txt')).toBe('s3://my-bucket/a/b.txt');
    expect(objectUri('/data', 'a/b.txt')).toBe('/data/a/b.txt');
    expect(objectUri('/', 'b.txt')).toBe('/b.txt');
  });
});
