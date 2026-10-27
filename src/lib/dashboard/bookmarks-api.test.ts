import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invalidate } = vi.hoisted(() => ({ invalidate: vi.fn() }));

vi.mock('$app/navigation', () => ({ invalidate }));

import { addBookmark, updateBookmark, removeBookmark } from './bookmarks-api.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const FIELDS = {
  productId: 'trino',
  name: 'Production Trino',
  environment: 'prod',
  url: 'https://trino.example.com',
  pinned: false
};

describe('bookmarks-api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    invalidate.mockResolvedValue(undefined);
  });

  it('sends each change as JSON to its endpoint and reloads the bookmarks', async () => {
    await addBookmark(FIELDS);
    await updateBookmark('b/1', { pinned: true });
    await removeBookmark('b/1');

    expect(fetchMock.mock.calls).toEqual([
      [
        '/api/bookmarks',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(FIELDS)
        }
      ],
      [
        '/api/bookmarks/b%2F1',
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: '{"pinned":true}'
        }
      ],
      ['/api/bookmarks/b%2F1', { method: 'DELETE' }]
    ]);
    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenCalledWith('app:bookmarks');
  });

  it('rejects without reloading when the server refuses the change', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(removeBookmark('b1')).rejects.toThrow('500');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('resolves when the change is saved but reloading the list fails', async () => {
    invalidate.mockRejectedValue(new Error('session expired'));

    await expect(addBookmark(FIELDS)).resolves.toBeUndefined();
  });
});
