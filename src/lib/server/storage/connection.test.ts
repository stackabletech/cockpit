import { beforeEach, describe, expect, it, vi } from 'vitest';

const { select, update } = vi.hoisted(() => ({
  select: vi.fn(),
  update: vi.fn()
}));

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));
vi.mock('$lib/server/db.js', () => ({ db: { select, update } }));
vi.mock('./encryption-key.js', () => ({ storageEncryptionKey: () => Buffer.alloc(32, 1) }));

import { encrypt } from './encryption.js';
import { getConnectionFromHeader } from './connection.js';
import { STORAGE_CONNECTION_ID_HEADER } from '$lib/storage/connection-id-header.js';

const connectionId = '0b9f3c1e-8d4a-4f6b-9c2e-1a2b3c4d5e6f';
const key = Buffer.alloc(32, 1);

const payload = {
  host: 'storage.example.test',
  port: 9000,
  tls: { verification: 'Full' },
  accessStyle: 'Path',
  region: { name: 'eu-central-1' },
  credentials: { accessKey: 'access', secretKey: 'secret' }
};

function request(id: string | null = connectionId): Request {
  const headers = new Headers();
  if (id !== null) headers.set(STORAGE_CONNECTION_ID_HEADER, id);
  return new Request('http://localhost/api/storage/list', { headers });
}

function selectRows(rows: unknown[]) {
  select.mockReturnValue({ from: () => ({ where: () => ({ limit: () => rows }) }) });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: connectionId,
    encryptedPayload: encrypt(JSON.stringify(payload), key),
    additionalBuckets: ['extra'],
    updatedAt: new Date(),
    ...overrides
  };
}

describe('getConnectionFromHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockReturnValue({
      set: () => ({ where: () => Promise.resolve() })
    });
  });

  it('returns null without a connection header', async () => {
    await expect(getConnectionFromHeader(request(null), 'user-id')).resolves.toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it('rejects a connection ID that is not a UUID', async () => {
    await expect(getConnectionFromHeader(request('nope'), 'user-id')).rejects.toMatchObject({
      status: 400
    });
  });

  it('rejects an unknown connection', async () => {
    selectRows([]);
    await expect(getConnectionFromHeader(request(), 'user-id')).rejects.toMatchObject({
      status: 401
    });
  });

  it('returns the decrypted connection config', async () => {
    selectRows([row()]);
    await expect(getConnectionFromHeader(request(), 'user-id')).resolves.toEqual({
      type: 's3',
      host: 'storage.example.test',
      port: 9000,
      tls: { verification: 'Full' },
      accessStyle: 'Path',
      region: { name: 'eu-central-1' },
      credentials: { accessKey: 'access', secretKey: 'secret' },
      additionalBuckets: ['extra']
    });
  });

  it('rejects a payload that does not match the stored schema', async () => {
    const invalid = { ...payload, accessStyle: undefined };
    selectRows([row({ encryptedPayload: encrypt(JSON.stringify(invalid), key) })]);
    await expect(getConnectionFromHeader(request(), 'user-id')).rejects.toMatchObject({
      status: 500
    });
  });

  it('falls back to no additional buckets when the stored list is invalid', async () => {
    selectRows([row({ additionalBuckets: [42] })]);
    const config = await getConnectionFromHeader(request(), 'user-id');
    expect(config?.additionalBuckets).toEqual([]);
  });

  it('does not refresh a recently updated connection', async () => {
    selectRows([row({ updatedAt: new Date(Date.now() - 60_000) })]);
    await getConnectionFromHeader(request(), 'user-id');
    expect(update).not.toHaveBeenCalled();
  });

  it('refreshes updated_at when the connection was last used a while ago', async () => {
    selectRows([row({ updatedAt: new Date(Date.now() - 10 * 60_000) })]);
    await getConnectionFromHeader(request(), 'user-id');
    expect(update).toHaveBeenCalledTimes(1);
  });
});
