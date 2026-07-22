import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorageBrowserEnabled = vi.fn(() => true);
vi.mock('$lib/server/feature-flags.js', () => ({
  get storageBrowserEnabled() {
    return mockStorageBrowserEnabled();
  }
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

  it('returns disconnected default state', async () => {
    mockStorageBrowserEnabled.mockReturnValue(true);
    const result = await load(mockEvent());
    expect(result).toEqual({ connected: false, buckets: [], connectionType: null });
  });
});
