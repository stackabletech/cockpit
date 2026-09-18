import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockProvider = { putObject: vi.fn(), getObjectRange: vi.fn() };
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: () => mockProvider
}));

vi.mock('$lib/server/feature-flags.js', () => ({
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

function textBody(text: string): ReadableStream {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
}

describe('POST /api/storage/save-text', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves text body without truncation', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);
    const body = textBody('hello world');

    const res = await POST(
      mockEvent('bucket=b1&key=file.txt&originalSize=11&previewBytes=11', body)
    );

    expect(res.status).toBe(200);
    expect(mockProvider.putObject).toHaveBeenCalledWith(
      'file.txt',
      expect.anything(),
      'text/plain',
      11
    );
    expect(mockProvider.getObjectRange).not.toHaveBeenCalled();
  });

  it('saves newly created empty files', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);

    const res = await POST(
      mockEvent('bucket=b1&key=file.txt&originalSize=0&previewBytes=0', textBody('new text'))
    );

    expect(res.status).toBe(200);
    expect(mockProvider.putObject).toHaveBeenCalledWith(
      'file.txt',
      expect.anything(),
      'text/plain',
      8
    );
  });

  it('merges edit tail when truncated', async () => {
    const tailBytes = new TextEncoder().encode('...tail');
    const tailStream = new ReadableStream({
      start(controller) {
        controller.enqueue(tailBytes);
        controller.close();
      }
    });
    mockProvider.getObjectRange.mockResolvedValue(tailStream);
    mockProvider.putObject.mockResolvedValue(undefined);

    const body = textBody('edited');

    const res = await POST(
      mockEvent('bucket=b1&key=file.txt&originalSize=100&previewBytes=10', body)
    );

    expect(res.status).toBe(200);
    expect(mockProvider.getObjectRange).toHaveBeenCalledWith('file.txt', 10, 99);
    expect(mockProvider.putObject).toHaveBeenCalledWith(
      'file.txt',
      expect.anything(),
      'text/plain',
      13 // 6 ("edited") + 7 ("...tail")
    );
  });

  it('returns 400 when key is missing', async () => {
    await expect(POST(mockEvent('bucket=b1&originalSize=10'))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns 400 when originalSize is invalid', async () => {
    await expect(POST(mockEvent('bucket=b1&key=file.txt&originalSize=abc'))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns 400 when request body is missing', async () => {
    await expect(POST(mockEvent('bucket=b1&key=file.txt&originalSize=10'))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('returns 413 when file exceeds max editable size', async () => {
    const body = textBody('content');

    await expect(
      POST(mockEvent('bucket=b1&key=file.txt&originalSize=6000000', body))
    ).rejects.toThrow(expect.objectContaining({ status: 413 }));
  });

  it('cancels read when body exceeds max size mid-stream', async () => {
    mockProvider.putObject.mockResolvedValue(undefined);

    const largeChunk = new Uint8Array(3_000_000);
    const smallChunk = new Uint8Array(3_000_000);
    let callCount = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (callCount === 0) {
          controller.enqueue(largeChunk);
          callCount++;
        } else if (callCount === 1) {
          controller.enqueue(smallChunk);
          callCount++;
        } else {
          controller.close();
        }
      }
    });

    await expect(
      POST(mockEvent('bucket=b1&key=file.txt&originalSize=7000000', body))
    ).rejects.toThrow(expect.objectContaining({ status: 413 }));
  });
});
