import { describe, it, expect, vi, beforeEach } from 'vitest';
import { S3ServiceException, PutObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ trace: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}));

// Hoist so the factory closure can reference them
const { mockUploadDone, MockUpload } = vi.hoisted(() => {
  const mockUploadDone = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const MockUpload = vi.fn(function (this: { done: typeof mockUploadDone }, _: unknown) {
    this.done = mockUploadDone;
  });
  return { mockUploadDone, MockUpload };
});

vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: MockUpload
}));

// Mock createS3Client — we inject a fake client directly so this is rarely called
vi.mock('./s3-client.js', () => ({
  createS3Client: vi.fn().mockReturnValue({ send: vi.fn() })
}));

import { S3StorageProvider } from './s3-provider.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeS3Error(name: string, httpStatusCode?: number): S3ServiceException {
  const err = new S3ServiceException({
    name,
    message: `${name} error`,
    $fault: 'client',
    $metadata: { httpStatusCode }
  });
  err.name = name;
  return err;
}

function makeProvider() {
  const send = vi.fn();
  const client = { send } as unknown as import('@aws-sdk/client-s3').S3Client;
  const config = {
    type: 's3' as const,
    host: 'minio.example.com',
    accessStyle: 'Path' as const,
    region: { name: 'us-east-1' },
    bucket: 'test-bucket'
  };
  const provider = new S3StorageProvider(config, client);
  return { provider, send };
}

// ---------------------------------------------------------------------------
// listObjects
// ---------------------------------------------------------------------------

describe('S3StorageProvider.listObjects', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns objects and directories from S3 output', async () => {
    send.mockResolvedValue({
      CommonPrefixes: [{ Prefix: 'folder/' }],
      Contents: [{ Key: 'file.txt', Size: 100, LastModified: new Date('2024-01-01') }],
      IsTruncated: false,
      NextContinuationToken: undefined
    });

    const result = await provider.listObjects('', 50);

    expect(result.objects).toHaveLength(2);
    expect(result.objects[0]).toMatchObject({ key: 'folder/', isDirectory: true, size: 0 });
    expect(result.objects[1]).toMatchObject({ key: 'file.txt', isDirectory: false, size: 100 });
    expect(result.hasNextPage).toBe(false);
    expect(result.nextContinuationToken).toBeNull();
  });

  it('filters out the prefix itself from Contents', async () => {
    send.mockResolvedValue({
      CommonPrefixes: [],
      Contents: [
        { Key: 'myprefix/', Size: 0, LastModified: new Date() },
        { Key: 'myprefix/file.txt', Size: 42, LastModified: new Date() }
      ],
      IsTruncated: false
    });

    const result = await provider.listObjects('myprefix/', 50);
    expect(result.objects).toHaveLength(1);
    expect(result.objects[0].key).toBe('myprefix/file.txt');
  });

  it('handles missing CommonPrefixes and Contents gracefully', async () => {
    send.mockResolvedValue({ IsTruncated: false });

    const result = await provider.listObjects('', 20);
    expect(result.objects).toHaveLength(0);
    expect(result.hasNextPage).toBe(false);
  });

  it('propagates pagination token', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'a.txt', Size: 1, LastModified: new Date() }],
      IsTruncated: true,
      NextContinuationToken: 'token-abc'
    });

    const result = await provider.listObjects('', 10, 'prev-token');
    expect(result.hasNextPage).toBe(true);
    expect(result.nextContinuationToken).toBe('token-abc');
    expect(result.continuationToken).toBe('prev-token');
  });

  it('passes null continuationToken through as null', async () => {
    send.mockResolvedValue({ IsTruncated: false });

    const result = await provider.listObjects('', 10, null);
    expect(result.continuationToken).toBeNull();
  });

  it('converts empty prefix string to undefined in S3 command', async () => {
    send.mockResolvedValue({ IsTruncated: false });
    await provider.listObjects('', 10);
    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.Prefix).toBeUndefined();
  });

  it('passes non-empty prefix to S3', async () => {
    send.mockResolvedValue({ IsTruncated: false });
    await provider.listObjects('some/prefix/', 10);
    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.Prefix).toBe('some/prefix/');
  });

  it('uses fallbacks when object fields are missing', async () => {
    send.mockResolvedValue({
      CommonPrefixes: [{}],
      Contents: [{ Key: 'x.txt' }],
      IsTruncated: false
    });

    const result = await provider.listObjects('', 10);
    expect(result.objects[0].key).toBe(''); // Prefix fallback
    expect(result.objects[1].key).toBe('x.txt');
    expect(result.objects[1].size).toBe(0);
    expect(result.objects[1].lastModified).toEqual(new Date(0));
  });
});

// ---------------------------------------------------------------------------
// getObject
// ---------------------------------------------------------------------------

describe('S3StorageProvider.getObject', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns stream and metadata', async () => {
    const fakeStream = new ReadableStream();
    send.mockResolvedValue({
      Body: { transformToWebStream: () => fakeStream },
      ContentType: 'text/plain',
      ContentLength: 42,
      ETag: '"abc123"'
    });

    const result = await provider.getObject('file.txt');
    expect(result.stream).toBe(fakeStream);
    expect(result.contentType).toBe('text/plain');
    expect(result.contentLength).toBe(42);
    expect(result.etag).toBe('"abc123"');
  });

  it('throws when Body is missing', async () => {
    send.mockResolvedValue({ Body: null });
    await expect(provider.getObject('missing.txt')).rejects.toThrow(
      'Object missing.txt has no body'
    );
  });

  it('throws when Body is undefined', async () => {
    send.mockResolvedValue({});
    await expect(provider.getObject('missing.txt')).rejects.toThrow(
      'Object missing.txt has no body'
    );
  });
});

// ---------------------------------------------------------------------------
// getObjectRange
// ---------------------------------------------------------------------------

describe('S3StorageProvider.getObjectRange', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns stream for byte range', async () => {
    const fakeStream = new ReadableStream();
    send.mockResolvedValue({
      Body: { transformToWebStream: () => fakeStream }
    });

    const result = await provider.getObjectRange('video.mp4', 0, 999);
    expect(result).toBe(fakeStream);

    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.Range).toBe('bytes=0-999');
  });

  it('throws when Body is missing', async () => {
    send.mockResolvedValue({});
    await expect(provider.getObjectRange('video.mp4', 0, 100)).rejects.toThrow(
      'Object video.mp4 has no body'
    );
  });
});

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------

describe('S3StorageProvider.getMetadata', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns metadata from HeadObject', async () => {
    send.mockResolvedValue({
      ContentLength: 1024,
      LastModified: new Date('2024-06-01'),
      ContentType: 'application/json',
      ETag: '"etag1"',
      Metadata: { 'x-custom': 'val' }
    });

    const result = await provider.getMetadata('data.json');
    expect(result.size).toBe(1024);
    expect(result.contentType).toBe('application/json');
    expect(result.etag).toBe('"etag1"');
    expect(result.customMetadata).toEqual({ 'x-custom': 'val' });
  });

  it('falls back to defaults when fields missing', async () => {
    send.mockResolvedValue({});

    const result = await provider.getMetadata('x');
    expect(result.size).toBe(0);
    expect(result.lastModified).toEqual(new Date(0));
    expect(result.contentType).toBeUndefined();
    expect(result.etag).toBeUndefined();
    expect(result.customMetadata).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// exists
// ---------------------------------------------------------------------------

describe('S3StorageProvider.exists', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns true when HeadObject succeeds', async () => {
    send.mockResolvedValue({});
    expect(await provider.exists('file.txt')).toBe(true);
  });

  it('returns false for NoSuchKey S3 error', async () => {
    send.mockRejectedValue(makeS3Error('NoSuchKey', 404));
    expect(await provider.exists('missing.txt')).toBe(false);
  });

  it('returns false for NotFound S3 error', async () => {
    send.mockRejectedValue(makeS3Error('NotFound', 404));
    expect(await provider.exists('missing.txt')).toBe(false);
  });

  it('returns false for 404 http status even with different error name', async () => {
    send.mockRejectedValue(makeS3Error('SomethingElse', 404));
    expect(await provider.exists('missing.txt')).toBe(false);
  });

  it('re-throws non-404 S3 errors', async () => {
    const err = makeS3Error('AccessDenied', 403);
    send.mockRejectedValue(err);
    await expect(provider.exists('protected.txt')).rejects.toThrow(err);
  });

  it('re-throws non-S3 errors', async () => {
    const err = new Error('network failure');
    send.mockRejectedValue(err);
    await expect(provider.exists('file.txt')).rejects.toThrow(err);
  });
});

// ---------------------------------------------------------------------------
// putObject
// ---------------------------------------------------------------------------

describe('S3StorageProvider.putObject', () => {
  let provider: S3StorageProvider;

  beforeEach(() => {
    ({ provider } = makeProvider());
    mockUploadDone.mockResolvedValue(undefined);
    MockUpload.mockClear();
  });

  it('creates Upload with correct params and calls done()', async () => {
    const body = Buffer.from('hello');
    await provider.putObject('file.txt', body, 'text/plain', 5);

    expect(MockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'file.txt',
          Body: body,
          ContentType: 'text/plain',
          ContentLength: 5
        })
      })
    );
    expect(mockUploadDone).toHaveBeenCalled();
  });

  it('omits ContentLength when not provided', async () => {
    await provider.putObject('file.txt', Buffer.from('x'), 'text/plain');

    const uploadParams = MockUpload.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(uploadParams.params.ContentLength).toBeUndefined();
  });

  it('accepts a ReadableStream as body', async () => {
    const stream = new ReadableStream();
    await provider.putObject('stream.txt', stream, 'application/octet-stream');

    const uploadParams = MockUpload.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(uploadParams.params.Body).toBe(stream);
  });

  it('sets queue and part size', async () => {
    await provider.putObject('f', Buffer.from('x'), 'text/plain');
    const opts = MockUpload.mock.calls[0][0] as { queueSize: number; partSize: number };
    expect(opts.queueSize).toBe(4);
    expect(opts.partSize).toBe(5 * 1024 * 1024);
  });

  it('uses PutObjectCommand for empty files instead of multipart Upload', async () => {
    const { send } = makeProvider();
    // Re-create provider with the send mock we can inspect
    const client = { send } as unknown as import('@aws-sdk/client-s3').S3Client;
    const config = {
      type: 's3' as const,
      host: 'localhost',
      accessStyle: 'Path' as const,
      region: { name: 'us-east-1' },
      bucket: 'test-bucket'
    };
    const emptyProvider = new S3StorageProvider(config, client);
    send.mockResolvedValue({});

    await emptyProvider.putObject('empty.txt', new ReadableStream(), 'text/plain', 0);

    expect(MockUpload).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
    const cmd = send.mock.calls[0][0];
    expect(cmd).toBeInstanceOf(PutObjectCommand);
    expect(cmd.input).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'empty.txt',
      ContentType: 'text/plain',
      ContentLength: 0
    });
    expect(Buffer.isBuffer(cmd.input.Body)).toBe(true);
    expect((cmd.input.Body as Buffer).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteObjects
// ---------------------------------------------------------------------------

describe('S3StorageProvider.deleteObjects', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns empty failed list on full success', async () => {
    send.mockResolvedValue({ Errors: [] });
    const result = await provider.deleteObjects(['a.txt', 'b.txt']);
    expect(result.failed).toHaveLength(0);
  });

  it('returns failed entries when S3 reports errors', async () => {
    send.mockResolvedValue({
      Errors: [{ Key: 'b.txt', Code: 'AccessDenied', Message: 'No permission' }]
    });
    const result = await provider.deleteObjects(['a.txt', 'b.txt']);
    expect(result.failed).toEqual([
      { key: 'b.txt', code: 'AccessDenied', message: 'No permission' }
    ]);
  });

  it('uses fallback empty string for missing Key in errors', async () => {
    send.mockResolvedValue({
      Errors: [{ Code: 'InternalError', Message: 'oops' }]
    });
    const result = await provider.deleteObjects(['x.txt']);
    expect(result.failed[0].key).toBe('');
  });

  it('handles undefined Errors from S3', async () => {
    send.mockResolvedValue({});
    const result = await provider.deleteObjects(['a.txt']);
    expect(result.failed).toHaveLength(0);
  });

  it('sends correct Delete structure to S3', async () => {
    send.mockResolvedValue({ Errors: [] });
    await provider.deleteObjects(['x.txt', 'y.txt']);
    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.Delete.Objects).toEqual([{ Key: 'x.txt' }, { Key: 'y.txt' }]);
    expect(sentCommand.input.Delete.Quiet).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listAllKeys
// ---------------------------------------------------------------------------

describe('S3StorageProvider.listAllKeys', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns all keys in a single page', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'a.txt' }, { Key: 'b.txt' }],
      IsTruncated: false
    });

    const keys = await provider.listAllKeys('');
    expect(keys).toEqual(['a.txt', 'b.txt']);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('paginates across multiple pages', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a.txt' }, { Key: 'b.txt' }],
        IsTruncated: true,
        NextContinuationToken: 'token-1'
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'c.txt' }],
        IsTruncated: false
      });

    const keys = await provider.listAllKeys('prefix/');
    expect(keys).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(send).toHaveBeenCalledTimes(2);

    // Second call must pass the continuation token
    const secondCall = send.mock.calls[1][0];
    expect(secondCall.input.ContinuationToken).toBe('token-1');
  });

  it('returns empty array when no contents', async () => {
    send.mockResolvedValue({ IsTruncated: false });
    const keys = await provider.listAllKeys('empty/');
    expect(keys).toEqual([]);
  });

  it('skips Contents entries with no Key', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'valid.txt' }, {}],
      IsTruncated: false
    });
    const keys = await provider.listAllKeys('');
    expect(keys).toEqual(['valid.txt']);
  });

  it('does not send delimiter (recursive listing)', async () => {
    send.mockResolvedValue({ IsTruncated: false });
    await provider.listAllKeys('p/');
    const sentCommand = send.mock.calls[0][0];
    expect(sentCommand.input.Delimiter).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// copyObject
// ---------------------------------------------------------------------------

describe('S3StorageProvider.copyObject', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
    mockUploadDone.mockResolvedValue(undefined);
    MockUpload.mockClear();
  });

  it('uses CopyObjectCommand for files under 5 GB', async () => {
    // HeadObject returns ContentLength = 1000
    send.mockResolvedValueOnce({ ContentLength: 1000 });
    // CopyObject succeeds
    send.mockResolvedValueOnce({});

    await provider.copyObject('src/file.txt', 'dst/file.txt');

    expect(send).toHaveBeenCalledTimes(2);
    const copyCmd = send.mock.calls[1][0];
    expect(copyCmd).toBeInstanceOf(CopyObjectCommand);
    expect(copyCmd.input).toMatchObject({
      Bucket: 'test-bucket',
      CopySource: '/test-bucket/src%2Ffile.txt',
      Key: 'dst/file.txt'
    });
    expect(MockUpload).not.toHaveBeenCalled();
  });

  it('streams via multipart upload for files over 5 GB', async () => {
    const fiveGB = 5 * 1024 * 1024 * 1024;
    const largeSize = fiveGB + 1;
    const fakeStream = new ReadableStream();

    // HeadObject returns ContentLength > 5 GB
    send.mockResolvedValueOnce({
      ContentLength: largeSize,
      ContentType: 'application/octet-stream'
    });
    // GetObject returns the stream
    send.mockResolvedValueOnce({
      Body: { transformToWebStream: () => fakeStream },
      ContentType: 'application/octet-stream',
      ContentLength: largeSize
    });

    await provider.copyObject('src/large.parquet', 'dst/large.parquet');

    expect(send).toHaveBeenCalledTimes(2);
    const getObjectCmd = send.mock.calls[1][0];
    expect(getObjectCmd.input.Key).toBe('src/large.parquet');
    expect(MockUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          Bucket: 'test-bucket',
          Key: 'dst/large.parquet',
          Body: fakeStream,
          ContentLength: largeSize
        })
      })
    );
    expect(mockUploadDone).toHaveBeenCalled();
  });

  it('uses ContentLength from HeadObject for streaming copy', async () => {
    const size = 6 * 1024 * 1024 * 1024;
    send.mockResolvedValueOnce({ ContentLength: size, ContentType: 'video/mp4' });
    send.mockResolvedValueOnce({
      Body: { transformToWebStream: () => new ReadableStream() },
      ContentType: 'video/mp4',
      ContentLength: size
    });

    await provider.copyObject('src/video.mp4', 'dst/video.mp4');

    const uploadParams = MockUpload.mock.calls[0][0] as { params: Record<string, unknown> };
    expect(uploadParams.params.ContentLength).toBe(size);
  });
});

// ---------------------------------------------------------------------------
// Constructor — uses createS3Client when no client injected
// ---------------------------------------------------------------------------

describe('S3StorageProvider constructor', () => {
  it('uses injected client when provided', () => {
    const send = vi.fn();
    const fakeClient = { send } as unknown as import('@aws-sdk/client-s3').S3Client;
    const provider = new S3StorageProvider(
      {
        type: 's3',
        host: 'minio.example.com',
        accessStyle: 'Path',
        region: { name: 'us-east-1' },
        bucket: 'b'
      },
      fakeClient
    );
    expect(provider).toBeDefined();
  });

  it('creates client via createS3Client when none provided', async () => {
    const { createS3Client } = await import('./s3-client.js');
    const mockCreate = vi.mocked(createS3Client);
    mockCreate.mockClear();

    new S3StorageProvider({
      type: 's3',
      host: 'minio.example.com',
      accessStyle: 'Path',
      region: { name: 'us-east-1' },
      bucket: 'b'
    });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ region: { name: 'us-east-1' }, bucket: 'b' })
    );
  });
});

// ---------------------------------------------------------------------------
// listContainers
// ---------------------------------------------------------------------------

describe('S3StorageProvider.listContainers', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('returns bucket names', async () => {
    send.mockResolvedValue({ Buckets: [{ Name: 'a' }, { Name: 'b' }] });
    expect(await provider.listContainers()).toEqual(['a', 'b']);
  });

  it('filters out buckets with no name', async () => {
    send.mockResolvedValue({ Buckets: [{ Name: 'a' }, { Name: undefined }, { Name: '' }] });
    expect(await provider.listContainers()).toEqual(['a']);
  });

  it('handles null Buckets in response', async () => {
    send.mockResolvedValue({ Buckets: null });
    expect(await provider.listContainers()).toEqual([]);
  });

  it('maps AccessDenied S3 error to HTTP 403', async () => {
    send.mockRejectedValue(makeS3Error('AccessDenied', 403));
    await expect(provider.listContainers()).rejects.toMatchObject({ status: 403 });
  });

  it('re-throws non-S3 errors', async () => {
    const err = new Error('network');
    send.mockRejectedValue(err);
    await expect(provider.listContainers()).rejects.toThrow('network');
  });
});

// ---------------------------------------------------------------------------
// Error handling — S3ServiceException → HTTP error mapping
// ---------------------------------------------------------------------------

describe('S3StorageProvider error handling', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('listObjects: maps AccessDenied to HTTP 403', async () => {
    send.mockRejectedValue(makeS3Error('AccessDenied', 403));
    await expect(provider.listObjects('', 10)).rejects.toMatchObject({ status: 403 });
  });

  it('listObjects: maps NoSuchBucket to HTTP 404', async () => {
    send.mockRejectedValue(makeS3Error('NoSuchBucket', 404));
    await expect(provider.listObjects('', 10)).rejects.toMatchObject({ status: 404 });
  });

  it('listObjects: re-throws non-S3 errors', async () => {
    send.mockRejectedValue(new Error('timeout'));
    await expect(provider.listObjects('', 10)).rejects.toThrow('timeout');
  });

  it('getObject: maps NoSuchKey to HTTP 404', async () => {
    send.mockRejectedValue(makeS3Error('NoSuchKey', 404));
    await expect(provider.getObject('k')).rejects.toMatchObject({ status: 404 });
  });

  it('getObject: maps AccessDenied to HTTP 403', async () => {
    send.mockRejectedValue(makeS3Error('AccessDenied', 403));
    await expect(provider.getObject('k')).rejects.toMatchObject({ status: 403 });
  });

  it('getObject: re-throws non-S3 errors', async () => {
    send.mockRejectedValue(new Error('gone'));
    await expect(provider.getObject('k')).rejects.toThrow('gone');
  });

  it('getObjectRange: maps S3 error to HTTP error', async () => {
    send.mockRejectedValue(makeS3Error('NoSuchKey', 404));
    await expect(provider.getObjectRange('k', 0, 100)).rejects.toMatchObject({ status: 404 });
  });

  it('getObjectRange: re-throws non-S3 errors', async () => {
    send.mockRejectedValue(new Error('network'));
    await expect(provider.getObjectRange('k', 0, 100)).rejects.toThrow('network');
  });

  it('getMetadata: maps NoSuchKey to HTTP 404', async () => {
    send.mockRejectedValue(makeS3Error('NoSuchKey', 404));
    await expect(provider.getMetadata('k')).rejects.toMatchObject({ status: 404 });
  });

  it('getMetadata: re-throws non-S3 errors', async () => {
    send.mockRejectedValue(new Error('gone'));
    await expect(provider.getMetadata('k')).rejects.toThrow('gone');
  });

  it('putObject: maps AccessDenied to HTTP 403', async () => {
    mockUploadDone.mockRejectedValue(makeS3Error('AccessDenied', 403));
    MockUpload.mockImplementationOnce(function (this: { done: typeof mockUploadDone }) {
      this.done = mockUploadDone;
    });
    await expect(provider.putObject('k', Buffer.from('x'), 'text/plain')).rejects.toMatchObject({
      status: 403
    });
  });

  it('putObject: re-throws non-S3 errors', async () => {
    mockUploadDone.mockRejectedValue(new Error('disk full'));
    MockUpload.mockImplementationOnce(function (this: { done: typeof mockUploadDone }) {
      this.done = mockUploadDone;
    });
    await expect(provider.putObject('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'disk full'
    );
  });

  it('deleteObjects: maps AccessDenied to HTTP 403', async () => {
    send.mockRejectedValue(makeS3Error('AccessDenied', 403));
    await expect(provider.deleteObjects(['file.txt'])).rejects.toMatchObject({ status: 403 });
  });

  it('deleteObjects: re-throws non-S3 errors', async () => {
    send.mockRejectedValue(new Error('network'));
    await expect(provider.deleteObjects(['file.txt'])).rejects.toThrow('network');
  });
});

// ---------------------------------------------------------------------------
// deleteObjects — directory expansion
// ---------------------------------------------------------------------------

describe('S3StorageProvider.deleteObjects directory expansion', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('expands directory prefixes and deletes all contained keys', async () => {
    // First call: ListObjectsV2 for dir/
    send.mockResolvedValueOnce({
      Contents: [{ Key: 'dir/a.txt' }, { Key: 'dir/b.txt' }],
      IsTruncated: false
    });
    // Second call: DeleteObjects
    send.mockResolvedValueOnce({ Errors: [] });

    const result = await provider.deleteObjects(['file.txt', 'dir/']);

    const deleteCall = send.mock.calls[1][0];
    expect(deleteCall.input.Delete.Objects).toEqual([
      { Key: 'file.txt' },
      { Key: 'dir/a.txt' },
      { Key: 'dir/b.txt' }
    ]);
    expect(result).toEqual({ failed: [] });
  });

  it('uses directory key itself when no children found', async () => {
    send.mockResolvedValueOnce({ IsTruncated: false }); // listAllKeys returns []
    send.mockResolvedValueOnce({ Errors: [] }); // deleteObjects

    await provider.deleteObjects(['empty/']);

    const deleteCall = send.mock.calls[1][0];
    expect(deleteCall.input.Delete.Objects).toEqual([{ Key: 'empty/' }]);
  });

  it('returns empty result for no keys', async () => {
    const result = await provider.deleteObjects([]);
    expect(result).toEqual({ failed: [] });
    expect(send).not.toHaveBeenCalled();
  });
});
