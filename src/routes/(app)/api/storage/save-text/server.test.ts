import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';

const mockProvider = {
  putObject: vi.fn(),
  putObjectIfMatch: vi.fn(),
  getObjectRange: vi.fn(),
  getMetadata: vi.fn()
};
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

vi.mock('$lib/server/storage/config.js', () => ({
  maxEditableFileSize: 5242880
}));

import { POST } from './+server.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(params: string, body?: ReadableStream | null) {
  const url = new URL(`http://localhost/api/storage/save-text?${params}`);
  return {
    url,
    request: {
      headers: new Headers(CONNECTION_HEADER),
      body: body ?? null
    },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: { name: 'us-east-1' } }
    }
  } as unknown as Parameters<typeof POST>[0];
}

function bytesBody(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

function textBody(text: string): ReadableStream {
  return bytesBody(new TextEncoder().encode(text));
}

/** `error()` throws, so capture the HttpError it creates for use as a rejection. */
function httpError(status: number, message: string): unknown {
  try {
    error(status, message);
  } catch (err) {
    return err;
  }
}

const ETAG = '"abc123"';
const etagParam = `etag=${encodeURIComponent(ETAG)}`;

describe('POST /api/storage/save-text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.getMetadata.mockResolvedValue({ size: 11, etag: ETAG });
    mockProvider.putObjectIfMatch.mockResolvedValue('"def456"');
  });

  it('writes the body conditionally on the loaded ETag and returns the new ETag', async () => {
    const res = await POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`, textBody('hello')));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ etag: '"def456"' });
    expect(mockProvider.putObjectIfMatch).toHaveBeenCalledWith(
      'file.txt',
      Buffer.from('hello'),
      'text/plain',
      ETAG
    );
    expect(mockProvider.putObject).not.toHaveBeenCalled();
  });

  it('writes exactly the bytes it received (no tail merge from the stored object)', async () => {
    // Old behaviour: previewBytes < originalSize appended the stored tail to
    // the edited head, corrupting multi-byte and UTF-16 content.
    const res = await POST(
      mockEvent(
        `bucket=b1&key=file.txt&${etagParam}&originalSize=100&previewBytes=10`,
        textBody('edited')
      )
    );

    expect(res.status).toBe(200);
    expect(mockProvider.getObjectRange).not.toHaveBeenCalled();
    expect(mockProvider.putObjectIfMatch).toHaveBeenCalledWith(
      'file.txt',
      Buffer.from('edited'),
      'text/plain',
      ETAG
    );
  });

  it('preserves multi-byte UTF-8 content byte for byte', async () => {
    const bytes = new TextEncoder().encode('﻿grüße – 日本語 🚀');
    await POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`, bytesBody(bytes)));

    const written = mockProvider.putObjectIfMatch.mock.calls[0][1] as Buffer;
    expect(new Uint8Array(written)).toEqual(bytes);
  });

  it('passes the content type through', async () => {
    await POST(
      mockEvent(`bucket=b1&key=a.json&${etagParam}&contentType=application%2Fjson`, textBody('{}'))
    );
    expect(mockProvider.putObjectIfMatch).toHaveBeenCalledWith(
      'a.json',
      expect.anything(),
      'application/json',
      ETAG
    );
  });

  it('returns 409 when the ETag changed since the content was loaded', async () => {
    mockProvider.getMetadata.mockResolvedValue({ size: 11, etag: '"someone-else"' });

    await expect(
      POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`, textBody('mine')))
    ).rejects.toThrow(expect.objectContaining({ status: 409 }));
    expect(mockProvider.putObjectIfMatch).not.toHaveBeenCalled();
  });

  it('returns 409 when the object was deleted since it was loaded', async () => {
    mockProvider.getMetadata.mockRejectedValue(httpError(404, 'Object not found'));

    await expect(
      POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`, textBody('mine')))
    ).rejects.toThrow(expect.objectContaining({ status: 409 }));
    expect(mockProvider.putObjectIfMatch).not.toHaveBeenCalled();
  });

  it('propagates a 409 from the conditional write', async () => {
    mockProvider.putObjectIfMatch.mockRejectedValue(httpError(409, 'modified'));

    await expect(
      POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`, textBody('mine')))
    ).rejects.toThrow(expect.objectContaining({ status: 409 }));
  });

  it('returns 400 when the ETag is missing', async () => {
    await expect(POST(mockEvent('bucket=b1&key=file.txt', textBody('x')))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(mockProvider.putObjectIfMatch).not.toHaveBeenCalled();
  });

  it('returns 400 when key is missing', async () => {
    await expect(POST(mockEvent(`bucket=b1&${etagParam}`, textBody('x')))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns 400 when request body is missing', async () => {
    await expect(POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns 413 when the stored file exceeds max editable size', async () => {
    mockProvider.getMetadata.mockResolvedValue({ size: 6_000_000, etag: ETAG });

    await expect(
      POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`, textBody('content')))
    ).rejects.toThrow(expect.objectContaining({ status: 413 }));
    expect(mockProvider.putObjectIfMatch).not.toHaveBeenCalled();
  });

  it('cancels read when body exceeds max size mid-stream', async () => {
    let callCount = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (callCount < 2) {
          controller.enqueue(new Uint8Array(3_000_000));
          callCount++;
        } else {
          controller.close();
        }
      }
    });

    await expect(POST(mockEvent(`bucket=b1&key=file.txt&${etagParam}`, body))).rejects.toThrow(
      expect.objectContaining({ status: 413 })
    );
    expect(mockProvider.putObjectIfMatch).not.toHaveBeenCalled();
  });
});
