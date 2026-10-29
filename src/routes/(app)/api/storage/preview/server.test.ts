import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3ServiceException } from '@aws-sdk/client-s3';

const mockGetMetadata = vi.fn();
vi.mock('$lib/server/storage/utils.js', () => ({
  getProvider: vi.fn(() => ({ getMetadata: mockGetMetadata }))
}));

vi.mock('$lib/server/storage/wrap-provider.js', () => ({
  withStorageHttpErrors: (p: unknown) => p
}));

vi.mock('$lib/server/storage/preview/binary.js', () => ({
  KNOWN_BINARY_TYPES: new Set(['application/zip']),
  binaryPreview: vi.fn(() => new Response(null, { headers: { 'X-Preview-Renderable': 'false' } }))
}));

vi.mock('$lib/server/storage/preview/stream.js', () => ({
  streamPreview: vi.fn(async () => new Response('preview content'))
}));

vi.mock('$lib/server/storage/config.js', () => ({
  filePreviewRows: 250,
  textPreviewBytes: 262144,
  imagePreviewBytes: 5242880,
  pdfPreviewBytes: 26214400,
  filePreviewColumns: 50,
  maxEditableFileSize: 5242880,
  parquetDisallowedCompression: []
}));

vi.mock('$lib/server/storage/preview/csv.js', () => ({
  getCsvPreview: vi.fn(async () => {
    const body =
      JSON.stringify({ t: 'h', h: ['a', 'b'] }) + '\n' + JSON.stringify({ t: 'd' }) + '\n';
    return new Response(body, {
      headers: { 'X-Preview-Format': 'csv', 'X-Preview-Renderable': 'true' }
    });
  })
}));

vi.mock('$lib/server/storage/preview/parquet.js', () => ({
  getParquetPreview: vi.fn(async () => {
    const body = JSON.stringify({ headers: ['a'], rows: [['1']], totalRows: 1 });
    return new Response(body, {
      headers: { 'X-Preview-Format': 'parquet', 'X-Preview-Renderable': 'true' }
    });
  })
}));

vi.mock('$lib/server/storage/s3-errors.js', () => ({
  mapS3ErrorToHttp: vi.fn((err) => {
    throw err;
  })
}));

import { GET } from './+server.js';
import { binaryPreview } from '$lib/server/storage/preview/binary.js';
import { streamPreview } from '$lib/server/storage/preview/stream.js';
import { getParquetPreview } from '$lib/server/storage/preview/parquet.js';
import { getCsvPreview } from '$lib/server/storage/preview/csv.js';
import { mapS3ErrorToHttp } from '$lib/server/storage/s3-errors.js';

const CONNECTION_HEADER = {
  'x-storage-connection': btoa(JSON.stringify({ type: 's3', region: 'us-east-1' }))
};

function mockEvent(params: string) {
  const url = new URL(`http://localhost/api/storage/preview?${params}`);
  return {
    url,
    request: { headers: new Headers(CONNECTION_HEADER) },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      storageConfig: { type: 's3', region: { name: 'us-east-1' } },
      storageConnectionId: 'connection-1'
    }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/storage/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns binary preview for known binary types', async () => {
    mockGetMetadata.mockResolvedValue({ contentType: 'application/zip', size: 5000 });

    await GET(mockEvent('bucket=b1&key=archive.zip'));

    expect(binaryPreview).toHaveBeenCalledWith('application/zip', 5000);
  });

  it('normalises Excel CSV content type', async () => {
    mockGetMetadata.mockResolvedValue({ contentType: 'application/vnd.ms-excel', size: 100 });

    await GET(mockEvent('bucket=b1&key=data.csv'));

    expect(getCsvPreview).toHaveBeenCalledWith(
      expect.anything(),
      'data.csv',
      0,
      250,
      100,
      expect.anything(),
      false,
      'b1',
      'connection-1'
    );
  });

  it('normalises Excel TSV content type for text preview', async () => {
    mockGetMetadata.mockResolvedValue({ contentType: 'application/vnd.ms-excel', size: 200 });

    await GET(mockEvent('bucket=b1&key=data.tsv'));

    expect(streamPreview).toHaveBeenCalledWith(
      expect.anything(),
      'data.tsv',
      'text/tab-separated-values',
      200,
      'client',
      expect.anything()
    );
  });

  it('does not normalise Excel content type for non-CSV/TSV extensions', async () => {
    mockGetMetadata.mockResolvedValue({ contentType: 'application/vnd.ms-excel', size: 300 });

    await GET(mockEvent('bucket=b1&key=workbook.xls'));

    expect(streamPreview).toHaveBeenCalledWith(
      expect.anything(),
      'workbook.xls',
      'application/vnd.ms-excel',
      300,
      'client',
      expect.anything()
    );
  });

  it('passes text/tab-separated-values content type through unchanged', async () => {
    mockGetMetadata.mockResolvedValue({
      contentType: 'text/tab-separated-values',
      size: 150
    });

    await GET(mockEvent('bucket=b1&key=data.tsv'));

    expect(streamPreview).toHaveBeenCalledWith(
      expect.anything(),
      'data.tsv',
      'text/tab-separated-values',
      150,
      'client',
      expect.anything()
    );
  });

  it('uses text preview for TSV files with generic content types', async () => {
    mockGetMetadata.mockResolvedValue({
      contentType: 'application/octet-stream',
      size: 75
    });

    await GET(mockEvent('bucket=b1&key=report.tsv'));

    expect(streamPreview).toHaveBeenCalledWith(
      expect.anything(),
      'report.tsv',
      'application/octet-stream',
      75,
      'client',
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
      'client',
      expect.anything()
    );
  });

  it('detects parquet by content-type and delegates to getParquetPreview', async () => {
    mockGetMetadata.mockResolvedValue({
      contentType: 'application/vnd.apache.parquet',
      size: 5000
    });

    const res = await GET(mockEvent('bucket=b1&key=data.parquet'));

    expect(getParquetPreview).toHaveBeenCalledWith(
      expect.anything(),
      'data.parquet',
      0,
      250,
      expect.anything(),
      expect.objectContaining({ size: 5000 }),
      false,
      'b1',
      'connection-1'
    );
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
  });

  it('detects parquet by .parquet extension', async () => {
    mockGetMetadata.mockResolvedValue({
      contentType: 'application/octet-stream',
      size: 5000
    });

    const res = await GET(mockEvent('bucket=b1&key=measurements.parquet'));

    expect(getParquetPreview).toHaveBeenCalledWith(
      expect.anything(),
      'measurements.parquet',
      0,
      250,
      expect.anything(),
      expect.objectContaining({ size: 5000 }),
      false,
      'b1',
      'connection-1'
    );
    expect(res.headers.get('X-Preview-Format')).toBe('parquet');
  });

  it('handles zero-size parquet file gracefully', async () => {
    mockGetMetadata.mockResolvedValue({
      contentType: 'application/vnd.apache.parquet',
      size: 0
    });

    await GET(mockEvent('bucket=b1&key=empty.parquet'));

    expect(getParquetPreview).toHaveBeenCalledWith(
      expect.anything(),
      'empty.parquet',
      0,
      250,
      expect.anything(),
      expect.objectContaining({ size: 0 }),
      false,
      'b1',
      'connection-1'
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

  describe('row range bounds', () => {
    it.each([
      ['limit=1000000000'],
      ['limit=1e9'],
      ['limit=251'],
      ['limit=0'],
      ['limit=-1'],
      ['limit=abc'],
      ['limit=Infinity'],
      ['offset=-1'],
      ['offset=1.5'],
      ['offset=abc'],
      ['offset=1e400']
    ])('rejects %s with 400', async (params) => {
      mockGetMetadata.mockResolvedValue({ contentType: 'application/x-parquet', size: 50000 });

      await expect(GET(mockEvent(`bucket=b1&key=large.parquet&${params}`))).rejects.toMatchObject({
        status: 400
      });
      expect(mockGetMetadata).not.toHaveBeenCalled();
      expect(getParquetPreview).not.toHaveBeenCalled();
    });

    it('passes in-range chunks through', async () => {
      mockGetMetadata.mockResolvedValue({ contentType: 'application/x-parquet', size: 50000 });

      await GET(mockEvent('bucket=b1&key=large.parquet&offset=1000000&limit=250&data=true'));

      expect(getParquetPreview).toHaveBeenCalledWith(
        expect.anything(),
        'large.parquet',
        1000000,
        250,
        expect.anything(),
        expect.objectContaining({ size: 50000 }),
        true,
        'b1',
        'connection-1'
      );
    });
  });
});
