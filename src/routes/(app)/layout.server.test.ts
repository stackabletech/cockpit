import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listBookmarks } = vi.hoisted(() => ({ listBookmarks: vi.fn() }));

vi.mock('$lib/server/dashboard/bookmarks-db.js', () => ({ listBookmarks }));
vi.mock('$lib/server/feature-flags.js', () => ({ storageBrowserEnabled: false }));

import { load } from './+layout.server.js';

const BOOKMARK = {
  id: '00000000-0000-0000-0000-000000000001',
  productId: 'trino',
  name: 'Production Trino',
  environment: 'prod',
  url: 'https://trino.example.com',
  pinned: false,
  createdAt: '2026-10-27T10:00:00.000Z'
};

function mockEvent(user: { id: string } | undefined) {
  return {
    locals: { user, logger: { error: vi.fn() } },
    depends: vi.fn()
  } as unknown as Parameters<typeof load>[0];
}

describe('(app) layout load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads the signed-in user’s bookmarks and can be invalidated', async () => {
    listBookmarks.mockResolvedValue([BOOKMARK]);
    const event = mockEvent({ id: 'user-1' });

    const data = await load(event);

    expect(data).toMatchObject({ bookmarks: [BOOKMARK] });
    expect(listBookmarks).toHaveBeenCalledWith('user-1');
    expect(event.depends).toHaveBeenCalledWith('app:bookmarks');
  });

  it('has no bookmarks without a signed-in user', async () => {
    const data = await load(mockEvent(undefined));

    expect(data).toMatchObject({ bookmarks: null });
    expect(listBookmarks).not.toHaveBeenCalled();
  });

  it('logs and hides bookmarks instead of failing the page when the database fails', async () => {
    listBookmarks.mockRejectedValue(new Error('connection refused'));
    const event = mockEvent({ id: 'user-1' });

    const data = await load(event);

    expect(data).toMatchObject({ bookmarks: null });
    expect(event.locals.logger.error).toHaveBeenCalled();
  });
});
