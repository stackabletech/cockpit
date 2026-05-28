import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/storage/service.js', () => ({
  uploadObject: vi.fn()
}));

vi.mock('$lib/server/auth-utils.js', () => ({
  getUserId: vi.fn(() => 'test-user')
}));

import { POST } from './+server.js';
import { uploadObject } from '$lib/server/storage/service.js';

function mockEvent(opts: {
  params?: string;
  body?: ReadableStream | null;
  headers?: Record<string, string>;
}) {
  const url = new URL(
    `http://localhost/storage/api/upload?${opts.params ?? 'bucket=b1&key=file.txt'}`
  );
  const headers = new Headers(
    opts.headers ?? { 'Content-Type': 'text/plain', 'Content-Length': '42' }
  );
  const body = 'body' in opts ? opts.body : new ReadableStream();
  return {
    url,
    request: { body, headers },
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } }
  } as any;
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
    vi.mocked(uploadObject).mockResolvedValue(undefined as any);
    const body = new ReadableStream();

    const res = await POST(
      mockEvent({
        body,
        headers: { 'Content-Type': 'image/png; charset=utf-8', 'Content-Length': '100' }
      })
    );

    expect(res.status).toBe(201);
    expect(uploadObject).toHaveBeenCalledWith(
      'test-user',
      'b1',
      'file.txt',
      body,
      'image/png',
      100
    );
  });

  it('defaults content type to application/octet-stream', async () => {
    vi.mocked(uploadObject).mockResolvedValue(undefined as any);

    const res = await POST(mockEvent({ headers: {} }));

    expect(res.status).toBe(201);
    expect(vi.mocked(uploadObject).mock.calls[0][4]).toBe('application/octet-stream');
  });
});
