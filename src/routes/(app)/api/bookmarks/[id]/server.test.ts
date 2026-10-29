import { describe, it, expect, vi, beforeEach } from 'vitest';

const { bookmarksDb } = vi.hoisted(() => ({
  bookmarksDb: { updateBookmark: vi.fn(), deleteBookmark: vi.fn() }
}));

vi.mock('$lib/server/dashboard/bookmarks-db.js', () => bookmarksDb);

import { PATCH, DELETE } from './+server.js';

const BOOKMARK_ID = '3f1c2a9e-7b4d-4c8a-9e2f-5d6b7a8c9d01';
const BOOKMARK = {
  id: BOOKMARK_ID,
  productId: 'trino',
  name: 'Production Trino',
  environment: 'prod',
  url: 'https://trino.example.com',
  pinned: true,
  createdAt: '2026-10-27T10:00:00.000Z'
};

function mockEvent(
  method: string,
  body?: unknown,
  { id = BOOKMARK_ID, user = { id: 'user-1' } as { id: string } | null } = {}
) {
  const request = new Request(`http://localhost/api/bookmarks/${id}`, {
    method,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
  return {
    request,
    params: { id },
    locals: { user, logger: { debug: vi.fn(), info: vi.fn() } }
  } as unknown as Parameters<typeof PATCH>[0];
}

describe('/api/bookmarks/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates only the submitted fields of the user’s bookmark', async () => {
    bookmarksDb.updateBookmark.mockResolvedValue(BOOKMARK);

    const response = await PATCH(mockEvent('PATCH', { pinned: true }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(BOOKMARK);
    expect(bookmarksDb.updateBookmark).toHaveBeenCalledWith('user-1', BOOKMARK_ID, {
      pinned: true
    });
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['no known fields', { unknown: true }],
    ['an invalid URL', { url: 'ftp://example.com' }],
    ['an unknown product', { productId: 'unknown' }]
  ])('rejects an update with %s with 400', async (_name, body) => {
    await expect(PATCH(mockEvent('PATCH', body))).rejects.toMatchObject({ status: 400 });
    expect(bookmarksDb.updateBookmark).not.toHaveBeenCalled();
  });

  it('deletes the user’s bookmark', async () => {
    bookmarksDb.deleteBookmark.mockResolvedValue(true);

    const response = await DELETE(mockEvent('DELETE'));

    expect(response.status).toBe(204);
    expect(bookmarksDb.deleteBookmark).toHaveBeenCalledWith('user-1', BOOKMARK_ID);
  });

  it('answers 404 for bookmarks the user does not have', async () => {
    bookmarksDb.updateBookmark.mockResolvedValue(null);
    bookmarksDb.deleteBookmark.mockResolvedValue(false);

    await expect(PATCH(mockEvent('PATCH', { pinned: true }))).rejects.toMatchObject({
      status: 404
    });
    await expect(DELETE(mockEvent('DELETE'))).rejects.toMatchObject({ status: 404 });
  });

  it('answers 400 for ids that are not UUIDs without querying', async () => {
    await expect(DELETE(mockEvent('DELETE', undefined, { id: 'nope' }))).rejects.toMatchObject({
      status: 400
    });
    expect(bookmarksDb.deleteBookmark).not.toHaveBeenCalled();
  });

  it('answers 401 without a signed-in user', async () => {
    await expect(PATCH(mockEvent('PATCH', { pinned: true }, { user: null }))).rejects.toMatchObject(
      { status: 401 }
    );
    await expect(DELETE(mockEvent('DELETE', undefined, { user: null }))).rejects.toMatchObject({
      status: 401
    });
  });
});
