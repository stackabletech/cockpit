import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  insertValues: vi.fn(),
  deleteWhere: vi.fn(),
  selectWhere: vi.fn(),
  getProvider: vi.fn(),
  getConnectionForUser: vi.fn(),
  listAllKeys: vi.fn(),
  getMetadata: vi.fn(),
  getObject: vi.fn(),
  orderBy: vi.fn()
}));

vi.mock('$lib/server/db.js', () => ({
  db: {
    insert: () => ({ values: mocks.insertValues }),
    delete: () => ({ where: mocks.deleteWhere }),
    select: () => ({ from: () => ({ where: mocks.selectWhere }) })
  }
}));
vi.mock('./utils.js', () => ({ getProvider: mocks.getProvider }));
vi.mock('./connections-db.js', () => ({ getConnectionForUser: mocks.getConnectionForUser }));

import {
  createDownloadManifest,
  openDownloadManifestPart,
  recreateDownloadManifest
} from './download-manifests.js';

const config = {
  type: 's3' as const,
  host: 's3.example.test',
  accessStyle: 'Path' as const,
  region: { name: 'eu-central-1' }
};

function queryResult(rows: unknown[]) {
  return { limit: async () => rows };
}

describe('download manifests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listAllKeys.mockResolvedValue(['folder/a.txt', 'folder/b.txt']);
    mocks.getMetadata.mockResolvedValue({ size: 5 });
    mocks.getObject.mockResolvedValue({
      stream: new ReadableStream({ start: (controller) => controller.close() })
    });
    mocks.getProvider.mockReturnValue({
      listAllKeys: mocks.listAllKeys,
      getMetadata: mocks.getMetadata,
      getObject: mocks.getObject
    });
    mocks.insertValues.mockReturnValue({ returning: async () => [{ id: 'manifest-1' }] });
    mocks.deleteWhere.mockResolvedValue(undefined);
  });

  it('expands folders and persists only resolved metadata, not credentials', async () => {
    const manifest = await createDownloadManifest({
      userId: 'user-1',
      connectionId: '00000000-0000-4000-8000-000000000001',
      bucket: 'bucket',
      prefix: 'folder/',
      keys: ['folder/'],
      config: { ...config, credentials: { accessKey: 'secret-access', secretKey: 'secret-key' } }
    });

    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]?.filename).toBe('folder.zip');
    // The reported size is the uncompressed payload total; no exact archive
    // size is computed or persisted anywhere.
    expect(manifest.files[0]?.size).toBe(10);
    const persisted = mocks.insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(persisted).toMatchObject({
      userId: 'user-1',
      bucket: 'bucket',
      prefix: 'folder/',
      connectionId: '00000000-0000-4000-8000-000000000001',
      format: 'zip'
    });
    expect(persisted).not.toHaveProperty('archiveSize');
    expect(JSON.stringify(persisted)).not.toContain('archive_size');
    expect(JSON.stringify(persisted)).not.toContain('secret-access');
    expect(JSON.stringify(persisted)).not.toContain('secret-key');
    expect(mocks.deleteWhere).toHaveBeenCalledTimes(1);
  });

  it('uses individual files for up to three file keys', async () => {
    const manifest = await createDownloadManifest({
      userId: 'user-1',
      connectionId: '00000000-0000-4000-8000-000000000001',
      bucket: 'bucket',
      prefix: '',
      keys: ['a.txt', 'b.txt', 'c.txt'],
      config
    });
    expect(manifest.files.map((file) => file.filename)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });

  it('does not open an expired, foreign, or deleted-connection manifest', async () => {
    mocks.selectWhere.mockReturnValue(queryResult([]));
    await expect(openDownloadManifestPart('user-1', 'manifest-1', 1)).resolves.toBeNull();

    mocks.selectWhere.mockReturnValue(
      queryResult([
        {
          id: 'manifest-1',
          bucket: 'bucket',
          connectionId: '00000000-0000-4000-8000-000000000001',
          entries: [{ key: 'a.txt', size: 5, isDirectory: false }],
          archive: null,
          expiresAt: new Date(Date.now() + 60_000)
        }
      ])
    );
    mocks.getConnectionForUser.mockResolvedValue(null);
    await expect(openDownloadManifestPart('user-1', 'manifest-1', 1)).resolves.toBeNull();
    expect(mocks.deleteWhere).toHaveBeenCalledWith(expect.anything());
  });

  it('validates and recreates selections with refreshed object sizes', async () => {
    mocks.selectWhere.mockReturnValue(
      queryResult([
        {
          id: 'manifest-1',
          bucket: 'bucket',
          connectionId: '00000000-0000-4000-8000-000000000001',
          entries: [
            { key: 'a.txt', size: 5, isDirectory: false },
            { key: 'folder/', size: 0, isDirectory: true },
            { key: 'folder/b.txt', size: 7, isDirectory: false },
            { key: 'folder/c.txt', size: 8, isDirectory: false }
          ],
          archive: 'original.zip',
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date()
        }
      ])
    );
    mocks.getConnectionForUser.mockResolvedValue(config);
    mocks.getMetadata.mockImplementation(async (key: string) => ({
      size: key === 'a.txt' ? 40 : 9
    }));
    await expect(
      recreateDownloadManifest('user-1', 'manifest-1', ['a.txt'])
    ).resolves.toMatchObject({ files: [{ filename: 'a.txt', size: 40 }] });
    const persisted = mocks.insertValues.mock.calls[0]?.[0] as { entries: Array<{ size: number }> };
    expect(persisted.entries).toEqual([{ key: 'a.txt', size: 40, isDirectory: false }]);
    await expect(
      recreateDownloadManifest('user-1', 'manifest-1', ['other.txt'])
    ).resolves.toBeNull();
    await expect(
      recreateDownloadManifest('user-1', 'manifest-1', ['a.txt', 'a.txt'])
    ).resolves.toBeNull();
    await expect(recreateDownloadManifest('user-1', 'manifest-1', [])).resolves.toBeNull();
  });
});
