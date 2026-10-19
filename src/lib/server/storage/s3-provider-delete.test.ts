import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Client } from '@aws-sdk/client-s3';
import {
  S3ServiceException,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand
} from '@aws-sdk/client-s3';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ trace: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}));

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
  const provider = new S3StorageProvider(config, client);
  return { provider, send };
}

function keys(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => ({ Key: `${prefix}${i}` }));
}

/** The command type of every `send` call, in order. */
function commandSequence(send: ReturnType<typeof vi.fn>): string[] {
  return send.mock.calls.map(([command]) => {
    if (command instanceof ListObjectsV2Command) return 'list';
    if (command instanceof DeleteObjectsCommand) return 'delete-batch';
    if (command instanceof DeleteObjectCommand) return 'delete-single';
    return 'other';
  });
}

describe('S3StorageProvider.deleteObjects streaming directory expansion', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('deletes each full chunk before listing the next page', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) return { Errors: [] };
      return command.input.ContinuationToken
        ? { Contents: keys('dir/b', 5), IsTruncated: false }
        : { Contents: keys('dir/a', 1000), IsTruncated: true, NextContinuationToken: 'token-1' };
    });

    const result = await provider.deleteObjects(['dir/'], true);

    expect(commandSequence(send)).toEqual(['list', 'delete-batch', 'list', 'delete-batch']);
    expect(send.mock.calls[1][0].input.Delete.Objects).toHaveLength(1000);
    expect(send.mock.calls[3][0].input.Delete.Objects).toEqual(keys('dir/b', 5));
    expect(result).toEqual({ failed: [] });
  });

  it('never sends more than 1000 keys in one DeleteObjects request', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) return { Errors: [] };
      return { Contents: keys('dir/', 999), IsTruncated: false };
    });

    await provider.deleteObjects(['a.txt', 'b.txt', 'dir/'], true);

    const sizes = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectsCommand)
      .map((command) => command.input.Delete!.Objects!.length);
    expect(sizes).toEqual([1000, 1]);
  });

  it('collects failures from every chunk', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) {
        const [first] = command.input.Delete!.Objects!;
        return { Errors: [{ Key: first.Key, Code: 'AccessDenied', Message: 'No permission' }] };
      }
      return command.input.ContinuationToken
        ? { Contents: keys('dir/b', 1), IsTruncated: false }
        : { Contents: keys('dir/a', 1000), IsTruncated: true, NextContinuationToken: 'token-1' };
    });

    const result = await provider.deleteObjects(['dir/'], true);

    expect(result.failed.map((f) => f.key)).toEqual(['dir/a0', 'dir/b0']);
  });

  it('deletes keys XML cannot carry inside a directory one by one', async () => {
    send.mockImplementation(async (command) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: 'dir/ok' }, { Key: 'dir/bad\u0001' }], IsTruncated: false };
      }
      return command instanceof DeleteObjectsCommand ? { Errors: [] } : {};
    });

    await provider.deleteObjects(['dir/'], true);

    expect(commandSequence(send)).toEqual(['list', 'delete-single', 'delete-batch']);
    expect(send.mock.calls[1][0].input.Key).toBe('dir/bad\u0001');
    expect(send.mock.calls[2][0].input.Delete.Objects).toEqual([{ Key: 'dir/ok' }]);
  });

  it('maps an access-denied listing to HTTP 403', async () => {
    send.mockRejectedValue(
      new S3ServiceException({
        name: 'AccessDenied',
        $fault: 'client',
        $metadata: { httpStatusCode: 403 },
        message: 'Access denied'
      })
    );

    await expect(provider.deleteObjects(['dir/'], true)).rejects.toMatchObject({ status: 403 });
  });

  it('keeps chunks deleted before a later listing page fails', async () => {
    const denied = new S3ServiceException({
      name: 'AccessDenied',
      $fault: 'client',
      $metadata: { httpStatusCode: 403 },
      message: 'Access denied'
    });
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectsCommand) return { Errors: [] };
      if (command.input.ContinuationToken) throw denied;
      return { Contents: keys('dir/a', 1000), IsTruncated: true, NextContinuationToken: 'token-1' };
    });

    await expect(provider.deleteObjects(['dir/'], true)).rejects.toMatchObject({ status: 403 });
    expect(commandSequence(send)).toEqual(['list', 'delete-batch', 'list']);
  });

  it('does not expand directories when expansion is off', async () => {
    send.mockResolvedValue({ Errors: [] });

    await provider.deleteObjects(['dir/'], false);

    expect(commandSequence(send)).toEqual(['delete-batch']);
    expect(send.mock.calls[0][0].input.Delete.Objects).toEqual([{ Key: 'dir/' }]);
  });
});
