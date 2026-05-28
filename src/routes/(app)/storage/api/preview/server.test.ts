import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3ServiceException } from '@aws-sdk/client-s3';

const mockGetMetadata = vi.fn();
vi.mock('$lib/server/storage/utils.js', () => ({
  getProviderForUser: vi.fn(() => ({ getMetadata: mockGetMetadata }))
}));

vi.mock('$lib/server/auth-utils.js', () => ({
  getUserId: vi.fn(() => 'test-user')
}));

vi.mock('$lib/server/storage/preview/binary.js', () => ({
  KNOWN_BINARY_TYPES: new Set(['application/zip']),
  binaryPreview: vi.fn(() => new Response(null, { headers: { 'X-Preview-Renderable': 'false' } }))
}));

vi.mock('$lib/server/storage/preview/stream.js', () => ({
  streamPreview: vi.fn(async () => new Response('preview content'))
}));

vi.mock('$lib/server/storage/s3-errors.js', () => ({
  mapS3ErrorToHttp: vi.fn((err) => {
    throw err;
  })
}));

import { GET } from './+server.js';
import { binaryPreview } from '$lib/server/storage/preview/binary.js';
import { streamPreview } from '$lib/server/storage/preview/stream.js';
import { mapS3ErrorToHttp } from '$lib/server/storage/s3-errors.js';

function mockEvent(params: string) {
  const url = new URL(`http://localhost/storage/api/preview?${params}`);
  return {
    url,
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /storage/api/preview', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns binary preview for known binary types', async () => {
    mockGetMetadata.mockResolvedValue({ contentType: 'application/zip', size: 5000 });

    await GET(mockEvent('bucket=b1&key=archive.zip'));

    expect(binaryPreview).toHaveBeenCalledWith('application/zip', 5000);
  });

  it('normalises Excel CSV content type', async () => {
    mockGetMetadata.mockResolvedValue({ contentType: 'application/vnd.ms-excel', size: 100 });

    await GET(mockEvent('bucket=b1&key=data.csv'));

    expect(streamPreview).toHaveBeenCalledWith(
      expect.anything(),
      'data.csv',
      'text/csv',
      100,
      'test-user',
      expect.anything()
    );
  });

  it('calls streamPreview for text types', async () => {
    mockGetMetadata.mockResolvedValue({ contentType: 'text/plain', size: 50 });

    await GET(mockEvent('bucket=b1&key=readme.txt'));

    expect(streamPreview).toHaveBeenCalledWith(
      expect.anything(),
      'readme.txt',
      'text/plain',
      50,
      'test-user',
      expect.anything()
    );
  });

  it('maps S3 errors to HTTP errors', async () => {
    const s3Err = new S3ServiceException({
      name: 'NoSuchKey',
      message: 'not found',
      $fault: 'client',
      $metadata: { httpStatusCode: 404 }
    });
    mockGetMetadata.mockRejectedValue(s3Err);

    await expect(GET(mockEvent('bucket=b1&key=missing.txt'))).rejects.toThrow();
    expect(mapS3ErrorToHttp).toHaveBeenCalledWith(s3Err, {
      bucket: 'b1',
      key: 'missing.txt',
      operation: 'preview'
    });
  });
});
