import { error } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import type { StorageProvider } from './provider.js';
import { withStorageHttpErrors } from './wrap-provider.js';

/** Shape of adapter-node's `SvelteKitError`, which SvelteKit does not export. */
class PayloadTooLargeError extends Error {
  status = 413;
  text = 'Payload Too Large';
}

function providerRejecting(err: unknown): StorageProvider {
  return { putObject: vi.fn().mockRejectedValue(err) } as unknown as StorageProvider;
}

function putObject(provider: StorageProvider) {
  return withStorageHttpErrors(provider).putObject('k', Buffer.alloc(0), 'text/plain');
}

describe('withStorageHttpErrors', () => {
  it('passes results through', async () => {
    const provider = {
      listContainers: vi.fn().mockResolvedValue(['b1'])
    } as unknown as StorageProvider;

    await expect(withStorageHttpErrors(provider).listContainers()).resolves.toEqual(['b1']);
  });

  it('keeps HTTP errors as they are', async () => {
    let httpError: unknown;
    try {
      error(403, 'Access denied');
    } catch (err) {
      httpError = err;
    }

    await expect(putObject(providerRejecting(httpError))).rejects.toBe(httpError);
  });

  it('maps a request body above BODY_SIZE_LIMIT to 413', async () => {
    const tooLarge = new PayloadTooLargeError(
      'Content-length of 10485760 exceeds limit of 6291456 bytes.'
    );

    await expect(putObject(providerRejecting(tooLarge))).rejects.toMatchObject({
      status: 413,
      body: { message: 'Content-length of 10485760 exceeds limit of 6291456 bytes.' }
    });
  });

  it('maps other errors to 502', async () => {
    await expect(putObject(providerRejecting(new Error('socket hang up')))).rejects.toMatchObject({
      status: 502,
      body: { message: 'socket hang up' }
    });
  });

  it('maps non-Error rejections to 502', async () => {
    await expect(putObject(providerRejecting('boom'))).rejects.toMatchObject({
      status: 502,
      body: { message: 'Storage provider error' }
    });
  });

  it('maps synchronous throws', () => {
    const provider = {
      exists: vi.fn(() => {
        throw new Error('bad config');
      })
    } as unknown as StorageProvider;

    expect(() => withStorageHttpErrors(provider).exists('k')).toThrow(
      expect.objectContaining({ status: 502 })
    );
  });
});
