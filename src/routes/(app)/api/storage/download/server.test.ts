import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = { getObject: vi.fn(), getMetadata: vi.fn() };
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { GET, HEAD } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(params: string) {
  const url = new URL(`http://localhost/api/storage/download?${params}`);
  return {
    url,
    request: { headers: new Headers(CONNECTION_HEADER) },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: 'us-east-1' }
    }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/storage/download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('streams download with correct headers', async () => {
    const stream = new ReadableStream();
    mockProvider.getObject.mockResolvedValue({
      stream,
      contentType: 'text/csv',
      contentLength: 1234,
      etag: '"abc"'
    });

    const res = await GET(mockEvent('bucket=b1&key=path/data.csv'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('data.csv');
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Content-Length')).toBe('1234');
    expect(res.headers.get('ETag')).toBe('"abc"');
  });

  it('uses application/octet-stream when no content type', async () => {
    mockProvider.getObject.mockResolvedValue({
      stream: new ReadableStream(),
      contentType: undefined,
      contentLength: undefined,
      etag: undefined
    });

    const res = await GET(mockEvent('bucket=b1&key=file.bin'));
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.has('Content-Length')).toBe(false);
  });
});

describe('HEAD /api/storage/download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with metadata headers', async () => {
    mockProvider.getMetadata.mockResolvedValue({
      contentType: 'application/json',
      size: 999
    });

    const res = await HEAD(mockEvent('bucket=b1&key=data.json'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Length')).toBe('999');
  });
});
