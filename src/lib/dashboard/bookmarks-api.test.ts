import { describe, it, expect, vi, beforeEach } from 'vitest';

const { invalidate, addToast } = vi.hoisted(() => ({ invalidate: vi.fn(), addToast: vi.fn() }));

vi.mock('$app/navigation', () => ({ invalidate }));
vi.mock('$lib/stores/toast.svelte.js', () => ({ addToast }));

import {
  addBookmark,
  BookmarkRequestError,
  updateBookmark,
  removeBookmark
} from './bookmarks-api.js';

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
    expect(addToast).not.toHaveBeenCalled();
  });

  it('reloads the list and rejects with the status when the server refuses the change', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

    const result = removeBookmark('b1');

    await expect(result).rejects.toBeInstanceOf(BookmarkRequestError);
    await expect(result).rejects.toMatchObject({ status: 404 });
    expect(invalidate).toHaveBeenCalledWith('app:bookmarks');
  });

  it('retries a failed reload once', async () => {
    invalidate.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(undefined);

    await addBookmark(FIELDS);

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(addToast).not.toHaveBeenCalled();
  });

  it('resolves and offers a page reload when the change is saved but the list cannot be reloaded', async () => {
    invalidate.mockRejectedValue(new Error('network'));

    await expect(addBookmark(FIELDS)).resolves.toBeUndefined();

    expect(invalidate).toHaveBeenCalledTimes(2);
    expect(addToast).toHaveBeenCalledWith('warning', expect.any(String), 0, [
      { label: 'Reload', onClick: expect.any(Function) }
    ]);
  });
});
