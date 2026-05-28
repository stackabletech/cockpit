import { describe, it, expect, vi } from 'vitest';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { mapS3ErrorToHttp } from './s3-errors.js';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}));

function makeS3Error(name: string, httpStatusCode?: number): S3ServiceException {
  const err = new S3ServiceException({
    name,
    message: `${name} happened`,
    $fault: 'client',
    $metadata: { httpStatusCode }
  });
  err.name = name;
  return err;
}

describe('mapS3ErrorToHttp', () => {
  it('re-throws non-S3 errors as-is', () => {
    const raw = new Error('network failure');
    expect(() => mapS3ErrorToHttp(raw, {})).toThrow(raw);
  });

  it('maps AccessDenied to 403', () => {
    const err = makeS3Error('AccessDenied', 403);
    expect(() => mapS3ErrorToHttp(err, { key: 'file.txt' })).toThrow(
      expect.objectContaining({ status: 403, body: { message: 'Access denied to "file.txt"' } })
    );
  });

  it('maps 403 status without AccessDenied name to 403', () => {
    const err = makeS3Error('SomeOtherCode', 403);
    expect(() => mapS3ErrorToHttp(err, {})).toThrow(
      expect.objectContaining({ status: 403, body: { message: 'Access denied' } })
    );
  });

  it('maps NoSuchKey to 404 with key message', () => {
    const err = makeS3Error('NoSuchKey', 404);
    expect(() => mapS3ErrorToHttp(err, { key: 'missing.csv' })).toThrow(
      expect.objectContaining({ status: 404, body: { message: 'Object "missing.csv" not found' } })
    );
  });

  it('maps NoSuchBucket to 404 with bucket message', () => {
    const err = makeS3Error('NoSuchBucket', 404);
    expect(() => mapS3ErrorToHttp(err, { bucket: 'my-bucket' })).toThrow(
      expect.objectContaining({ status: 404, body: { message: 'Bucket "my-bucket" not found' } })
    );
  });

  it('maps 404 status to not found with generic message', () => {
    const err = makeS3Error('NotFound', 404);
    expect(() => mapS3ErrorToHttp(err, {})).toThrow(
      expect.objectContaining({ status: 404, body: { message: 'Not found' } })
    );
  });

  it('maps other S3 errors to 502', () => {
    const err = makeS3Error('InternalError', 500);
    expect(() => mapS3ErrorToHttp(err, {})).toThrow(expect.objectContaining({ status: 502 }));
  });
});
