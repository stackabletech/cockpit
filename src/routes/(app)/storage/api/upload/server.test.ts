import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = { putObject: vi.fn() };
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

import { POST } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(opts: {
  params?: string;
  body?: ReadableStream | null;
  headers?: Record<string, string>;
}) {
  const url = new URL(
    `http://localhost/storage/api/upload?${opts.params ?? 'bucket=b1&key=file.txt'}`
  );
  const headers = new Headers(
    opts.headers ?? { 'Content-Type': 'text/plain', 'Content-Length': '42', ...CONNECTION_HEADER }
  );
  const body = 'body' in opts ? opts.body : new ReadableStream();
  return {
    url,
    request: { body, headers },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: 'us-east-1' }
    }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /storage/api/upload', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 400 when bucket/key missing', async () => {
    await expect(POST(mockEvent({ params: '' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('throws 400 when request body is missing', async () => {
    await expect(POST(mockEvent({ body: null }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('uploads and returns 201', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);
    const body = new ReadableStream();

    const res = await POST(
      mockEvent({
        body,
        headers: {
          'Content-Type': 'image/png; charset=utf-8',
          'Content-Length': '100',
          ...CONNECTION_HEADER
        }
      })
    );

    expect(res.status).toBe(201);
    expect(mockProvider.putObject).toHaveBeenCalledWith('file.txt', body, 'image/png', 100);
  });

  it('defaults content type to application/octet-stream', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);

    const res = await POST(mockEvent({ headers: { ...CONNECTION_HEADER } }));

    expect(res.status).toBe(201);
    expect(mockProvider.putObject.mock.calls[0][2]).toBe('application/octet-stream');
  });
});
