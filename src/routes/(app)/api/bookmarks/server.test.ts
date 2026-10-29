import { describe, it, expect, vi, beforeEach } from 'vitest';

const { bookmarksDb } = vi.hoisted(() => ({
  bookmarksDb: { listBookmarks: vi.fn(), createBookmark: vi.fn() }
}));

vi.mock('$lib/server/dashboard/bookmarks-db.js', () => bookmarksDb);

import { GET, POST } from './+server.js';

const FIELDS = {
  productId: 'trino',
  name: 'Production Trino',
  environment: 'prod',
  url: 'https://trino.example.com',
  pinned: false
};
const BOOKMARK = {
  ...FIELDS,
  id: '3f1c2a9e-7b4d-4c8a-9e2f-5d6b7a8c9d01',
  createdAt: '2026-10-27T10:00:00.000Z'
};

function mockEvent(method: string, body?: unknown, user: { id: string } | null = { id: 'user-1' }) {
  const request = new Request('http://localhost/api/bookmarks', {
    method,
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) })
  });
  return {
    request,
    locals: { user, logger: { debug: vi.fn(), info: vi.fn() } }
  } as unknown as Parameters<typeof POST>[0];
}

describe('/api/bookmarks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the requesting user’s bookmarks', async () => {
    bookmarksDb.listBookmarks.mockResolvedValue([BOOKMARK]);

    const response = await GET(mockEvent('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([BOOKMARK]);
    expect(bookmarksDb.listBookmarks).toHaveBeenCalledWith('user-1');
  });

  it('creates a bookmark from the trimmed form fields', async () => {
    bookmarksDb.createBookmark.mockResolvedValue(BOOKMARK);

    const response = await POST(
      mockEvent('POST', { ...FIELDS, name: ' Production Trino ', environment: ' prod ' })
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual(BOOKMARK);
    expect(bookmarksDb.createBookmark).toHaveBeenCalledWith('user-1', FIELDS);
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['an empty name', { ...FIELDS, name: ' ' }],
    ['an overlong name', { ...FIELDS, name: 'x'.repeat(41) }],
    ['a non-http URL', { ...FIELDS, url: 'javascript:alert(1)' }],
    ['a missing field', { name: 'Trino', url: 'https://trino.example.com' }],
    ['an unknown product', { ...FIELDS, productId: 'unknown' }],
    ['an empty product', { ...FIELDS, productId: '' }]
  ])('rejects %s with 400', async (_name, body) => {
    await expect(POST(mockEvent('POST', body))).rejects.toMatchObject({ status: 400 });
    expect(bookmarksDb.createBookmark).not.toHaveBeenCalled();
  });

  it('answers 409 once the user has reached the bookmark limit', async () => {
    bookmarksDb.createBookmark.mockResolvedValue(null);

    await expect(POST(mockEvent('POST', FIELDS))).rejects.toMatchObject({ status: 409 });
  });

  it('answers 401 without a signed-in user', async () => {
    await expect(GET(mockEvent('GET', undefined, null))).rejects.toMatchObject({ status: 401 });
    await expect(POST(mockEvent('POST', FIELDS, null))).rejects.toMatchObject({ status: 401 });
    expect(bookmarksDb.listBookmarks).not.toHaveBeenCalled();
    expect(bookmarksDb.createBookmark).not.toHaveBeenCalled();
  });
});
