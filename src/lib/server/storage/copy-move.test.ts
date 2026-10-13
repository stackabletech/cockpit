import { describe, expect, it, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import pino from 'pino';
import { performCopyOrMove } from './copy-move.js';
import type { StorageProvider } from './provider.js';

function provider(existing: string[]): StorageProvider {
  return {
    listObjects: vi.fn().mockResolvedValue({ objects: [] }),
    exists: vi.fn(async (key: string) => existing.includes(key)),
    copyObject: vi.fn(),
    deleteObjects: vi.fn().mockResolvedValue({ failed: [] }),
    listAllKeys: vi.fn()
  } as unknown as StorageProvider;
}

function move(source: StorageProvider, destinationKey?: string) {
  return performCopyOrMove({
    provider: source,
    sourceKeys: ['a.txt'],
    destinationPrefix: 'dest/',
    destinationKey,
    streamProgress: false,
    logger: pino({ level: 'silent' }),
    bucket: 'bucket',
    userId: 'user',
    deleteOriginals: true
  });
}

async function statusOf(promise: Promise<Response>): Promise<number> {
  try {
    return (await promise).status;
  } catch (err) {
    if (isHttpError(err)) return err.status;
    throw err;
  }
}

describe('performCopyOrMove', () => {
  it('rejects a rename onto an existing key with 409 and moves nothing', async () => {
    const source = provider(['dest/b.txt']);

    expect(await statusOf(move(source, 'dest/b.txt'))).toBe(409);
    expect(source.copyObject).not.toHaveBeenCalled();
    expect(source.deleteObjects).not.toHaveBeenCalled();
  });

  it('rejects a rename onto the source itself with 400', async () => {
    expect(await statusOf(move(provider(['a.txt']), 'a.txt'))).toBe(400);
  });

  it('returns 200 with the moved item for a successful rename', async () => {
    const response = await move(provider([]), 'dest/b.txt');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      moved: [{ sourceKey: 'a.txt', destKey: 'dest/b.txt' }],
      failed: []
    });
  });

  it('keeps reporting per-item failures with 200 when no destination key is given', async () => {
    const source = provider([]);
    vi.mocked(source.copyObject).mockRejectedValue(new Error('boom'));

    const response = await move(source);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      moved: [],
      failed: [{ sourceKey: 'a.txt', error: 'boom' }]
    });
  });
});
