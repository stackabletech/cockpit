import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

// Mock createS3Client — we inject a fake client directly so this is never called
vi.mock('./s3-client.js', () => ({
  createS3Client: vi.fn().mockReturnValue({ send: vi.fn() })
}));

import { S3StorageProvider } from './s3-provider.js';

function makeProvider() {
  const send = vi.fn();
  const client = { send } as unknown as S3Client;
  const config = {
    type: 's3' as const,
    host: 'minio.example.com',
    accessStyle: 'Path' as const,
    region: { name: 'us-east-1' },
    bucket: 'test-bucket'
  };
  return { provider: new S3StorageProvider(config, client), send };
}

// ---------------------------------------------------------------------------
// copyObject across buckets and with cancellation
// ---------------------------------------------------------------------------

describe('S3StorageProvider.copyObject options', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('reads the source from another bucket of the same connection', async () => {
    send.mockResolvedValueOnce({ ContentLength: 10 });
    send.mockResolvedValueOnce({});

    await provider.copyObject('a b.txt', 'dst/a b.txt', { sourceBucket: 'other-bucket' });

    expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'other-bucket', Key: 'a b.txt' });
    expect(send.mock.calls[1][0].input).toEqual({
      Bucket: 'test-bucket',
      CopySource: '/other-bucket/a%20b.txt',
      Key: 'dst/a b.txt'
    });
  });

  it('passes the abort signal to every request', async () => {
    const signal = new AbortController().signal;
    send.mockResolvedValueOnce({ ContentLength: 10 });
    send.mockResolvedValueOnce({});

    await provider.copyObject('a.txt', 'b.txt', { signal });

    expect(send.mock.calls.map((call) => call[1])).toEqual([
      { abortSignal: signal },
      { abortSignal: signal }
    ]);
  });

  it('cleans up an upload whose creation raced with a cancel', async () => {
    const controller = new AbortController();
    send.mockResolvedValueOnce({ ContentLength: 6 * 1024 * 1024 * 1024 });
    send.mockImplementationOnce(async () => {
      controller.abort();
      return { UploadId: 'upload-4' };
    });
    send.mockResolvedValueOnce({});

    await expect(
      provider.copyObject('src/big', 'dst/big', { signal: controller.signal })
    ).rejects.toThrow();

    // The creation itself is never aborted, so its upload ID is known and released.
    expect(send.mock.calls[1][1]).toBeUndefined();
    expect(send.mock.calls).toHaveLength(3);
    expect(send.mock.calls[2][0].constructor.name).toBe('AbortMultipartUploadCommand');
    expect(send.mock.calls[2][0].input).toMatchObject({ UploadId: 'upload-4' });
  });

  it('pins every part of a multipart copy to the source ETag', async () => {
    send.mockResolvedValueOnce({ ContentLength: 6 * 1024 * 1024 * 1024, ETag: '"v1"' });
    send.mockResolvedValueOnce({ UploadId: 'upload-5' });
    send.mockResolvedValue({ CopyPartResult: { ETag: '"part"' } });

    await provider.copyObject('src/big', 'dst/big');

    const partCopies = send.mock.calls
      .map((call) => call[0])
      .filter((cmd) => cmd.constructor.name === 'UploadPartCopyCommand');
    expect(partCopies).toHaveLength(24);
    for (const cmd of partCopies) {
      expect(cmd.input.CopySourceIfMatch).toBe('"v1"');
    }
  });

  it('fails and releases the upload when the source changes mid-copy', async () => {
    send.mockResolvedValueOnce({ ContentLength: 6 * 1024 * 1024 * 1024, ETag: '"v1"' });
    send.mockResolvedValueOnce({ UploadId: 'upload-6' });
    send.mockResolvedValueOnce({ CopyPartResult: { ETag: '"part-1"' } });
    send.mockRejectedValueOnce(
      Object.assign(new Error('At least one of the pre-conditions you specified did not hold'), {
        name: 'PreconditionFailed',
        $fault: 'client',
        $metadata: { httpStatusCode: 412 }
      })
    );
    send.mockResolvedValueOnce({});

    await expect(provider.copyObject('src/big', 'dst/big')).rejects.toThrow();

    const commands = send.mock.calls.map((call) => call[0].constructor.name);
    expect(commands).not.toContain('CompleteMultipartUploadCommand');
    expect(commands.at(-1)).toBe('AbortMultipartUploadCommand');
    expect(send.mock.calls.at(-1)?.[0].input).toMatchObject({ UploadId: 'upload-6' });
  });

  it('aborts a cancelled multipart copy without the cancelled signal', async () => {
    const controller = new AbortController();
    send.mockResolvedValueOnce({ ContentLength: 6 * 1024 * 1024 * 1024 });
    send.mockResolvedValueOnce({ UploadId: 'upload-3' });
    send.mockImplementationOnce(() => {
      controller.abort();
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
    send.mockResolvedValueOnce({});

    await expect(
      provider.copyObject('src/big', 'dst/big', { signal: controller.signal })
    ).rejects.toThrow('aborted');

    const [abortCmd, abortOptions] = send.mock.calls[3];
    expect(abortCmd.constructor.name).toBe('AbortMultipartUploadCommand');
    expect(abortCmd.input).toEqual({ Bucket: 'test-bucket', Key: 'dst/big', UploadId: 'upload-3' });
    expect(abortOptions).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// prefixExists
// ---------------------------------------------------------------------------

describe('S3StorageProvider.prefixExists', () => {
  it('lists one key without a delimiter so a bare folder marker counts', async () => {
    const { provider, send } = makeProvider();
    send.mockResolvedValueOnce({ Contents: [{ Key: 'docs/' }] });

    expect(await provider.prefixExists('docs/')).toBe(true);
    expect(send.mock.calls[0][0].input).toEqual({
      Bucket: 'test-bucket',
      Prefix: 'docs/',
      MaxKeys: 1,
      EncodingType: 'url'
    });
  });

  it('reports a prefix without objects as missing', async () => {
    const { provider, send } = makeProvider();
    send.mockResolvedValueOnce({});

    expect(await provider.prefixExists('docs/')).toBe(false);
  });
});
