import { describe, it, expect, vi } from 'vitest';
import {
  storageHref,
  fileLocation,
  fileHref,
  locationLabel,
  locationPath,
  locationHref,
  connectionLabel
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

describe('locationLabel (pinned location)', () => {
  it('returns bucket name when no prefix', () => {
    const pin: PinnedLocation = { connectionId: 'c1', bucket: 'my-bucket', prefix: '' };
    expect(locationLabel(pin)).toBe('my-bucket');
  });

  it('returns last segment of prefix', () => {
    const pin: PinnedLocation = {
      connectionId: 'c1',
      bucket: 'my-bucket',
      prefix: 'a/b/deep-path'
    };
    expect(locationLabel(pin)).toBe('deep-path');
  });
});

describe('locationHref (pinned location)', () => {
  it('generates href from pinned location', () => {
    const pin: PinnedLocation = { connectionId: 'c1', bucket: 'my-bucket', prefix: 'some/path' };
    expect(locationHref('s3.example.com', pin)).toBe(
      '/storage/browse/s3.example.com/my-bucket/some/path'
    );
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

describe('locationLabel (recent location)', () => {
  it('returns bucket name when no prefix', () => {
    const loc: RecentLocation = {
      bucket: 'my-bucket',
      prefix: '',
      visitedAt: '',
      connectionId: 'c1'
    };
    expect(locationLabel(loc)).toBe('my-bucket');
  });

  it('returns last prefix segment', () => {
    const loc: RecentLocation = {
      bucket: 'my-bucket',
      prefix: 'a/b/c',
      visitedAt: '',
      connectionId: 'c1'
    };
    expect(locationLabel(loc)).toBe('c');
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

describe('connectionLabel', () => {
  it('prefers the connection name', () => {
    expect(connectionLabel({ name: 'Prod', endpoint: 'https://s3.example.com' })).toBe('Prod');
  });

  it('falls back to the endpoint', () => {
    expect(connectionLabel({ name: '', endpoint: 'https://s3.example.com' })).toBe(
      'https://s3.example.com'
    );
  });

  it('falls back to S3 without name or endpoint', () => {
    expect(connectionLabel({ name: '', endpoint: null })).toBe('S3');
  });
});
