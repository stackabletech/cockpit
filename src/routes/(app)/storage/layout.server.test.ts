import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorageBrowserEnabled = vi.fn(() => true);
vi.mock('$lib/server/feature-flags.js', () => ({
  get storageBrowserEnabled() {
    return mockStorageBrowserEnabled();
  }
}));

vi.mock('$lib/server/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => Promise.resolve([]) }) }) })
  }
}));

vi.mock('$lib/server/storage/encryption.js', () => ({
  decrypt: vi.fn(() => JSON.stringify({ endpoint: 'https://s3.example.com' }))
}));

vi.mock('$lib/server/storage/encryption-key.js', () => ({
  storageEncryptionKey: () => Buffer.alloc(32)
}));

vi.mock('$lib/server/schema.js', () => ({
  userStorageConnections: {}
}));

import { load } from './+layout.server.js';

function mockEvent() {
  return {
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } }
  } as unknown as Parameters<typeof load>[0];
}

describe('storage layout server load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when storage browser is disabled', async () => {
    mockStorageBrowserEnabled.mockReturnValue(false);
    await expect(load(mockEvent())).rejects.toThrow(expect.objectContaining({ status: 404 }));
  });

  it('returns disconnected default state with empty connections list', async () => {
    mockStorageBrowserEnabled.mockReturnValue(true);
    const result = await load(mockEvent());
    expect(result).toMatchObject({
      connected: false,
      buckets: [],
      connections: [],
      activeConnectionId: null
    });
  });
});
