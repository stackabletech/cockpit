import { describe, it, expect, vi } from 'vitest';
import { S3ServiceException, type S3Client } from '@aws-sdk/client-s3';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

// Mock createS3Client — we inject a fake client directly so this is never called
vi.mock('./s3-client.js', () => ({
  createS3Client: vi.fn().mockReturnValue({ send: vi.fn() })
}));

import { S3StorageProvider } from './s3-provider.js';

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

const failures = [
  ['AccessDenied', 403],
  ['NotImplemented', 501]
] as const;

// ---------------------------------------------------------------------------
// Bucket info getters: "not configured" is empty, any other failure is null
// ---------------------------------------------------------------------------

describe('S3StorageProvider.getBucketVersioning', () => {
  it.each([
    ['Enabled', 'Enabled'],
    ['Suspended', 'Suspended'],
    [undefined, 'Disabled']
  ])('maps status %s to %s', async (status, expected) => {
    const { provider, send } = makeProvider();
    send.mockResolvedValue({ Status: status });
    expect(await provider.getBucketVersioning()).toBe(expected);
  });

  it.each(failures)('returns null on %s', async (name, status) => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(makeS3Error(name, status));
    expect(await provider.getBucketVersioning()).toBeNull();
  });

  it('returns null on a non-S3 error', async () => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(new Error('socket hang up'));
    expect(await provider.getBucketVersioning()).toBeNull();
  });
});

describe('S3StorageProvider.getBucketLifecycleRules', () => {
  it('maps configured rules', async () => {
    const { provider, send } = makeProvider();
    send.mockResolvedValue({
      Rules: [{ ID: 'expire', Status: 'Enabled', Expiration: { Days: 30 } }]
    });
    const rules = await provider.getBucketLifecycleRules();
    expect(rules).toHaveLength(1);
    expect(rules?.[0]).toMatchObject({ id: 'expire', status: 'Enabled' });
    expect(rules?.[0].expirations).toEqual([
      { days: 30, date: undefined, expiredObjectDeleteMarker: undefined }
    ]);
  });

  it('returns an empty list when no lifecycle configuration exists', async () => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(makeS3Error('NoSuchLifecycleConfiguration', 404));
    expect(await provider.getBucketLifecycleRules()).toEqual([]);
  });

  it.each(failures)('returns null on %s', async (name, status) => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(makeS3Error(name, status));
    expect(await provider.getBucketLifecycleRules()).toBeNull();
  });
});

describe('S3StorageProvider.getBucketTags', () => {
  it('maps the tag set', async () => {
    const { provider, send } = makeProvider();
    send.mockResolvedValue({ TagSet: [{ Key: 'team', Value: 'data' }] });
    expect(await provider.getBucketTags()).toEqual({ team: 'data' });
  });

  it('returns no tags when the bucket has no tag set', async () => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(makeS3Error('NoSuchTagSet', 404));
    expect(await provider.getBucketTags()).toEqual({});
  });

  it.each(failures)('returns null on %s', async (name, status) => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(makeS3Error(name, status));
    expect(await provider.getBucketTags()).toBeNull();
  });
});

describe('S3StorageProvider.getBucketAcl', () => {
  it('maps owner and grants', async () => {
    const { provider, send } = makeProvider();
    send.mockResolvedValue({
      Owner: { DisplayName: 'alice', ID: 'abc' },
      Grants: [{ Grantee: { ID: 'abc' }, Permission: 'FULL_CONTROL' }]
    });
    expect(await provider.getBucketAcl()).toEqual({
      owner: 'alice / abc',
      grants: [{ grantee: 'abc', permission: 'FULL_CONTROL' }]
    });
  });

  it.each(failures)('returns null on %s', async (name, status) => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(makeS3Error(name, status));
    expect(await provider.getBucketAcl()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Zero-length putObject maps S3 errors like the multipart path
// ---------------------------------------------------------------------------

describe('S3StorageProvider.putObject (empty object)', () => {
  it.each([
    ['AccessDenied', 403, 403],
    ['NoSuchBucket', 404, 404],
    ['InternalError', 500, 502]
  ])('maps %s to HTTP %i', async (name, s3Status, httpStatus) => {
    const { provider, send } = makeProvider();
    send.mockRejectedValue(makeS3Error(name, s3Status));

    const err = await provider
      .putObject('empty.txt', Buffer.alloc(0), 'text/plain', 0)
      .catch((e: unknown) => e);

    expect(isHttpError(err)).toBe(true);
    expect((err as { status: number }).status).toBe(httpStatus);
  });
});
