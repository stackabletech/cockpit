import { beforeEach, describe, expect, it, vi } from 'vitest';

const { select, insert, remove } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  remove: vi.fn()
}));

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));
vi.mock('$lib/server/db.js', () => ({
  db: { select, insert, delete: remove }
}));
vi.mock('./encryption-key.js', () => ({ storageEncryptionKey: () => Buffer.alloc(32, 1) }));

import { deleteConnection, getConnectionForUser, saveConnection } from './connections-db.js';

const config = {
  type: 's3' as const,
  host: 'storage.example.test',
  port: 9000,
  tls: { verification: 'Full' as const },
  accessStyle: 'Path' as const,
  region: { name: 'eu-central-1' },
  credentials: { accessKey: 'access', secretKey: 'secret' }
};

function selectRows(rows: unknown[]) {
  select.mockReturnValue({ from: () => ({ where: () => ({ limit: () => rows }) }) });
}

describe('storage connections database', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses a connection with matching credentials', async () => {
    selectRows([{ id: 'existing-id' }]);

    await expect(saveConnection('user-id', config)).resolves.toBe('existing-id');
    expect(insert).not.toHaveBeenCalled();
  });

  it('encrypts and inserts a new connection', async () => {
    selectRows([]);
    const returning = vi.fn().mockResolvedValue([{ id: 'new-id' }]);
    const values = vi.fn(() => ({ returning }));
    insert.mockReturnValue({ values });

    await expect(saveConnection('user-id', config)).resolves.toBe('new-id');
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        name: 'storage.example.test',
        encryptedPayload: expect.any(String),
        hash: expect.any(String)
      })
    );
  });

  it('retries with a numeric suffix after a name conflict', async () => {
    selectRows([]);
    const returning = vi
      .fn()
      .mockRejectedValueOnce(new Error('user_storage_connections_user_id_name_unique'))
      .mockResolvedValue([{ id: 'new-id' }]);
    const values = vi.fn(() => ({ returning }));
    insert.mockReturnValue({ values });

    await expect(saveConnection('user-id', config)).resolves.toBe('new-id');
    expect(values).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ name: 'storage.example.test 2' })
    );
  });

  it('reuses a concurrently created matching connection after a duplicate error', async () => {
    selectRows([]);
    const returning = vi
      .fn()
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint'));
    const values = vi.fn(() => ({ returning }));
    insert.mockReturnValue({ values });
    select.mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => [] }) }) });
    select.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => [{ id: 'existing-id' }] }) })
    });

    await expect(saveConnection('user-id', config)).resolves.toBe('existing-id');
  });

  it('returns null for a connection not owned by the user', async () => {
    selectRows([]);
    await expect(getConnectionForUser('user-id', 'connection-id')).resolves.toBeNull();
  });

  it('decrypts a stored connection configuration', async () => {
    const { encrypt } = await import('./encryption.js');
    selectRows([
      {
        encryptedPayload: encrypt(
          JSON.stringify({ ...config, credentials: config.credentials }),
          Buffer.alloc(32, 1)
        )
      }
    ]);

    await expect(getConnectionForUser('user-id', 'connection-id')).resolves.toEqual(config);
  });

  it('deletes only the requested user connection', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    remove.mockReturnValue({ where });

    await deleteConnection('user-id', 'connection-id');
    expect(where).toHaveBeenCalledOnce();
  });
});
