import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  S3ServiceException,
  type S3Client
} from '@aws-sdk/client-s3';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

vi.mock('./s3-client.js', () => ({
  createS3Client: vi.fn().mockReturnValue({ send: vi.fn() })
}));

import { S3StorageProvider } from './s3-provider.js';

function makeProvider() {
  const send = vi.fn();
  const client = { send } as unknown as S3Client;
  const provider = new S3StorageProvider(
    {
      type: 's3',
      host: 'garage.example.com',
      accessStyle: 'Path',
      region: { name: 'us-east-1' },
      bucket: 'test-bucket'
    },
    client
  );
  return { provider, send };
}

async function listRecursively(provider: S3StorageProvider, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  await provider.listAllKeysProgressively(prefix, (batch) => {
    keys.push(...batch.map((item) => item.key));
  });
  return keys;
}

// Keys as S3 returns them with `EncodingType=url`: AWS form-encodes a space as `+` and a `+` as
// `%2B`; other implementations send a space as `%20`.
const encodedKeys = [
  ['dir/tab%09name.txt', 'dir/tab\tname.txt'],
  ['dir/new%0Aline.txt', 'dir/new\nline.txt'],
  ['dir/carriage%0Dreturn.txt', 'dir/carriage\rreturn.txt'],
  ['dir/start%01of+heading.txt', 'dir/start\u0001of heading.txt'],
  ['dir/space%20and%2Bplus.txt', 'dir/space and+plus.txt'],
  ['dir/100%25.txt', 'dir/100%.txt'],
  ['dir/%C3%A4%E2%82%AC.txt', 'dir/ä€.txt']
] as const;

describe('S3StorageProvider listing encoding', () => {
  let provider: S3StorageProvider;
  let send: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    ({ provider, send } = makeProvider());
  });

  it('requests url-encoded listings and decodes keys and prefixes in listObjects', async () => {
    send.mockResolvedValue({
      CommonPrefixes: [{ Prefix: 'dir/sub%09folder+one/' }],
      Contents: encodedKeys.map(([Key]) => ({ Key, Size: 1 })),
      EncodingType: 'url',
      IsTruncated: true,
      NextContinuationToken: 'opaque+token%2F'
    });

    const page = await provider.listObjects('dir/', 50, 'previous+token%2F');

    const input = send.mock.calls[0][0].input;
    expect(input.EncodingType).toBe('url');
    expect(input.ContinuationToken).toBe('previous+token%2F');
    expect(page.objects.map((object) => object.key)).toEqual([
      'dir/sub\tfolder one/',
      ...encodedKeys.map(([, key]) => key)
    ]);
    expect(page.nextContinuationToken).toBe('opaque+token%2F');
  });

  it('filters out the echoed prefix after decoding', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'my+dir/' }, { Key: 'my+dir/a.txt' }],
      EncodingType: 'url',
      IsTruncated: false
    });

    const page = await provider.listObjects('my dir/', 50);

    expect(page.objects.map((object) => object.key)).toEqual(['my dir/a.txt']);
  });

  it('keeps a malformed encoded key unchanged', async () => {
    send.mockResolvedValue({
      Contents: [{ Key: 'broken%E0%A4%A.txt' }],
      IsTruncated: false,
      EncodingType: 'url'
    });

    const page = await provider.listObjects('', 50);

    expect(page.objects[0].key).toBe('broken%E0%A4%A.txt');
  });

  it('requests url-encoded listings and decodes keys in recursive listings', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: encodedKeys[0][0] }],
        EncodingType: 'url',
        IsTruncated: true,
        NextContinuationToken: 'next+token'
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: encodedKeys[4][0] }],
        IsTruncated: false,
        EncodingType: 'url'
      });

    const keys = await listRecursively(provider, 'dir/');

    expect(send.mock.calls.map(([command]) => command.input.EncodingType)).toEqual(['url', 'url']);
    expect(send.mock.calls[1][0].input.ContinuationToken).toBe('next+token');
    expect(keys).toEqual([encodedKeys[0][1], encodedKeys[4][1]]);
  });

  it('requests url-encoded listings and decodes keys when searching', async () => {
    send.mockResolvedValue({
      Contents: encodedKeys.map(([Key]) => ({ Key, Size: 1 })),
      EncodingType: 'url',
      IsTruncated: false
    });

    const { results } = await provider.search('', { prefix: 'dir/' });

    expect(send.mock.calls[0][0].input.EncodingType).toBe('url');
    expect(results.map((result) => result.key)).toEqual(encodedKeys.map(([, key]) => key));
  });

  it('deletes directory members under their decoded keys', async () => {
    send
      .mockResolvedValueOnce({
        Contents: [{ Key: 'dir/a+b%0A.txt' }],
        IsTruncated: false,
        EncodingType: 'url'
      })
      .mockResolvedValueOnce({});

    await provider.deleteObjects(['dir/'], true);

    expect(send.mock.calls[1][0].input.Delete.Objects).toEqual([{ Key: 'dir/a b\n.txt' }]);
  });

  it('deletes keys XML cannot carry one by one and the rest in a batch', async () => {
    const unsafeKeys = ['start\u0001of heading.txt', 'lone\uD800surrogate.txt'];
    send.mockImplementation(async (command) => {
      if (command instanceof DeleteObjectCommand && command.input.Key === unsafeKeys[1]) {
        throw new S3ServiceException({
          name: 'InvalidArgument',
          message: 'Invalid key',
          $fault: 'client',
          $metadata: { httpStatusCode: 400 }
        });
      }
      return {};
    });

    const result = await provider.deleteObjects(
      ['tab\tok.txt', ...unsafeKeys, 'new\nline.txt'],
      true
    );

    const batches = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectsCommand);
    expect(batches.map((command) => command.input.Delete?.Objects)).toEqual([
      [{ Key: 'tab\tok.txt' }, { Key: 'new\nline.txt' }]
    ]);
    const singles = send.mock.calls
      .map(([command]) => command)
      .filter((command) => command instanceof DeleteObjectCommand);
    expect(singles.map((command) => command.input.Key)).toEqual(unsafeKeys);
    expect(result.failed).toEqual([
      { key: unsafeKeys[1], code: 'InvalidArgument', message: 'Invalid key' }
    ]);
  });

  it('leaves keys unchanged when the response does not echo the url encoding', async () => {
    send.mockResolvedValue({
      CommonPrefixes: [{ Prefix: 'a+b%20dir/' }],
      Contents: [{ Key: 'a+b' }, { Key: '100%25' }],
      IsTruncated: false
    });

    const page = await provider.listObjects('', 50);
    const keys = await listRecursively(provider, '');
    const { results } = await provider.search('');

    expect(page.objects.map((object) => object.key)).toEqual(['a+b%20dir/', 'a+b', '100%25']);
    expect(keys).toEqual(['a+b', '100%25']);
    expect(results.map((result) => result.key)).toEqual(['a+b', '100%25']);
  });

  it('deletes keys XML cannot carry with at most four requests in flight', async () => {
    const unsafeKeys = Array.from({ length: 10 }, (_, index) => `key\u0001${index}`);
    let inFlight = 0;
    let maxInFlight = 0;
    send.mockImplementation(async (command) => {
      if (!(command instanceof DeleteObjectCommand)) return {};
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      if (command.input.Key === unsafeKeys[7]) {
        throw new S3ServiceException({
          name: 'AccessDenied',
          message: 'Access denied',
          $fault: 'client',
          $metadata: { httpStatusCode: 403 }
        });
      }
      return {};
    });

    const result = await provider.deleteObjects(unsafeKeys, true);

    const deleted = send.mock.calls.map(([command]) => command.input.Key);
    expect(deleted.sort()).toEqual([...unsafeKeys].sort());
    expect(maxInFlight).toBe(4);
    expect(result.failed).toEqual([
      { key: unsafeKeys[7], code: 'AccessDenied', message: 'Access denied' }
    ]);
  });
});
