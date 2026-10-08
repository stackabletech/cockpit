import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockStorageBrowserEnabled = vi.fn(() => true);
vi.mock('$lib/server/feature-flags.js', () => ({
  get storageBrowserEnabled() {
    return mockStorageBrowserEnabled();
  }
}));

import { load } from './+page.server.js';

function mockEvent() {
  return {
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } }
  } as unknown as Parameters<typeof load>[0];
}

describe('dashboard page server load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists Trino and storage when the storage browser is enabled', async () => {
    mockStorageBrowserEnabled.mockReturnValue(true);
    const result = await load(mockEvent());
    expect(result).toMatchObject({ services: ['trino', 'storage'] });
  });

  it('lists only Trino when the storage browser is disabled', async () => {
    mockStorageBrowserEnabled.mockReturnValue(false);
    const result = await load(mockEvent());
    expect(result).toMatchObject({ services: ['trino'] });
  });
});
