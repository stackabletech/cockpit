import { describe, it, expect } from 'vitest';
import { requireBucket, requireBucketKey } from './params.js';

describe('requireBucket', () => {
  it('throws 400 when bucket param is missing', () => {
    const url = new URL('http://localhost/storage/api/test');
    expect(() => requireBucket(url)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 when bucket param is empty', () => {
    const url = new URL('http://localhost/storage/api/test?bucket=');
    expect(() => requireBucket(url)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 when bucket param is whitespace only', () => {
    const url = new URL('http://localhost/storage/api/test?bucket=%20%20');
    expect(() => requireBucket(url)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('returns trimmed bucket name', () => {
    const url = new URL('http://localhost/storage/api/test?bucket=%20my-bucket%20');
    expect(requireBucket(url)).toBe('my-bucket');
  });
});

describe('requireBucketKey', () => {
  it('throws 400 when bucket is missing', () => {
    const url = new URL('http://localhost/storage/api/test?key=file.txt');
    expect(() => requireBucketKey(url)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 when key is missing', () => {
    const url = new URL('http://localhost/storage/api/test?bucket=my-bucket');
    expect(() => requireBucketKey(url)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('throws 400 when key is empty', () => {
    const url = new URL('http://localhost/storage/api/test?bucket=my-bucket&key=');
    expect(() => requireBucketKey(url)).toThrow(expect.objectContaining({ status: 400 }));
  });

  it('returns both bucket and key trimmed', () => {
    const url = new URL(
      'http://localhost/storage/api/test?bucket=%20b1%20&key=%20path/file.txt%20'
    );
    expect(requireBucketKey(url)).toEqual({ bucket: 'b1', key: 'path/file.txt' });
  });
});
