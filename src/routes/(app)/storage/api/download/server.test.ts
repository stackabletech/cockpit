import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/storage/service.js', () => ({
  downloadObject: vi.fn(),
  getObjectMetadata: vi.fn()
}));

vi.mock('$lib/server/auth-utils.js', () => ({
  getUserId: vi.fn(() => 'test-user')
}));

import { GET, HEAD } from './+server.js';
import { downloadObject, getObjectMetadata } from '$lib/server/storage/service.js';

function mockEvent(params: string) {
  const url = new URL(`http://localhost/storage/api/download?${params}`);
  return {
    url,
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } }
  } as any;
}

describe('GET /storage/api/download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('streams download with correct headers', async () => {
    const stream = new ReadableStream();
    vi.mocked(downloadObject).mockResolvedValue({
      stream,
      contentType: 'text/csv',
      contentLength: 1234,
      etag: '"abc"'
    } as any);

    const res = await GET(mockEvent('bucket=b1&key=path/data.csv'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('data.csv');
    expect(res.headers.get('Content-Type')).toBe('text/csv');
    expect(res.headers.get('Content-Length')).toBe('1234');
    expect(res.headers.get('ETag')).toBe('"abc"');
  });

  it('uses application/octet-stream when no content type', async () => {
    vi.mocked(downloadObject).mockResolvedValue({
      stream: new ReadableStream(),
      contentType: undefined,
      contentLength: undefined,
      etag: undefined
    } as any);

    const res = await GET(mockEvent('bucket=b1&key=file.bin'));
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.has('Content-Length')).toBe(false);
  });
});

describe('HEAD /storage/api/download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with metadata headers', async () => {
    vi.mocked(getObjectMetadata).mockResolvedValue({
      contentType: 'application/json',
      size: 999
    } as any);

    const res = await HEAD(mockEvent('bucket=b1&key=data.json'));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Content-Length')).toBe('999');
  });
});
