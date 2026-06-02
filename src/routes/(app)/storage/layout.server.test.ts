import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorageBrowserEnabled = vi.fn(() => true);
vi.mock('$lib/server/feature-flags.js', () => ({
  get storageBrowserEnabled() {
    return mockStorageBrowserEnabled();
  }
}));

vi.mock('$lib/server/storage/service.js', () => ({
  getConnection: vi.fn(),
  listBuckets: vi.fn()
}));

vi.mock('$lib/server/auth-utils.js', () => ({
  getUserId: vi.fn(() => 'test-user')
}));

import { load } from './+layout.server.js';
import { getConnection, listBuckets } from '$lib/server/storage/service.js';

function mockEvent() {
  return {
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } }
  } as unknown as Parameters<typeof load>[0];
}

describe('storage layout load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws 404 when storage browser is disabled', async () => {
    mockStorageBrowserEnabled.mockReturnValue(false);
    await expect(load(mockEvent())).rejects.toThrow(expect.objectContaining({ status: 404 }));
  });

  it('returns connected:false when no connection', async () => {
    mockStorageBrowserEnabled.mockReturnValue(true);
    vi.mocked(getConnection).mockReturnValue(null);

    const result = await load(mockEvent());
    expect(result).toEqual({ connected: false, buckets: [], connectionType: null });
  });

  it('returns buckets when connected', async () => {
    mockStorageBrowserEnabled.mockReturnValue(true);
    vi.mocked(getConnection).mockReturnValue({ type: 's3' } as unknown as ReturnType<
      typeof getConnection
    >);
    vi.mocked(listBuckets).mockResolvedValue(['bucket-a', 'bucket-b']);

    const result = await load(mockEvent());
    expect(result).toEqual({
      connected: true,
      buckets: ['bucket-a', 'bucket-b'],
      connectionType: 's3'
    });
  });

  it('returns empty buckets when listBuckets fails', async () => {
    mockStorageBrowserEnabled.mockReturnValue(true);
    vi.mocked(getConnection).mockReturnValue({ type: 's3' } as unknown as ReturnType<
      typeof getConnection
    >);
    vi.mocked(listBuckets).mockRejectedValue(new Error('network'));

    const result = await load(mockEvent());
    expect(result).toEqual({ connected: true, buckets: [], connectionType: 's3' });
  });
});
