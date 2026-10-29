import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { userBookmarks } from '$lib/server/schema.js';
import { BOOKMARK_LIMIT } from '$lib/dashboard/types.js';
import { listBookmarks, createBookmark, updateBookmark, deleteBookmark } from './bookmarks-db.js';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), debug: vi.fn() }) }
}));

const { mockDb } = vi.hoisted(() => ({
  mockDb: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn(), $count: vi.fn() }
}));

vi.mock('$lib/server/db.js', () => ({ db: mockDb }));

type ChainFn = (...args: unknown[]) => MockChain;

/** Mocked Drizzle query builder: every call returns the same chain, which is
 *  thenable and resolves to `result`. */
interface MockChain {
  from: Mock<ChainFn>;
  where: Mock<ChainFn>;
  orderBy: Mock<ChainFn>;
  values: Mock<ChainFn>;
  set: Mock<ChainFn>;
  returning: Mock<ChainFn>;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
}

function buildChain(result: unknown): MockChain {
  const chain: MockChain = {
    from: vi.fn<ChainFn>(() => chain),
    where: vi.fn<ChainFn>(() => chain),
    orderBy: vi.fn<ChainFn>(() => chain),
    values: vi.fn<ChainFn>(() => chain),
    set: vi.fn<ChainFn>(() => chain),
    returning: vi.fn<ChainFn>(() => chain),
    then: (resolve) => Promise.resolve(result).then(resolve)
  };
  return chain;
}

const USER_ID = 'user-1';
const BOOKMARK_ID = '3f1c2a9e-7b4d-4c8a-9e2f-5d6b7a8c9d01';
const FIELDS = {
  productId: 'trino',
  name: 'Production Trino',
  environment: 'prod',
  url: 'https://trino.example.com',
  pinned: false
};
const ROW = { id: BOOKMARK_ID, ...FIELDS, createdAt: new Date('2026-10-27T10:00:00.000Z') };
const BOOKMARK = { ...ROW, createdAt: '2026-10-27T10:00:00.000Z' };
const ownBookmark = and(eq(userBookmarks.userId, USER_ID), eq(userBookmarks.id, BOOKMARK_ID));

describe('bookmarks-db', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the user’s bookmarks oldest first with ISO timestamps', async () => {
    const chain = buildChain([ROW]);
    mockDb.select.mockReturnValue(chain);

    await expect(listBookmarks(USER_ID)).resolves.toEqual([BOOKMARK]);
    expect(chain.from).toHaveBeenCalledWith(userBookmarks);
    expect(chain.where).toHaveBeenCalledWith(eq(userBookmarks.userId, USER_ID));
    expect(chain.orderBy).toHaveBeenCalledWith(asc(userBookmarks.createdAt), asc(userBookmarks.id));
  });

  it('creates a bookmark owned by the user', async () => {
    const chain = buildChain([ROW]);
    mockDb.$count.mockResolvedValue(BOOKMARK_LIMIT - 1);
    mockDb.insert.mockReturnValue(chain);
    await expect(createBookmark(USER_ID, FIELDS)).resolves.toEqual(BOOKMARK);
    expect(mockDb.$count).toHaveBeenCalledWith(userBookmarks, eq(userBookmarks.userId, USER_ID));
    expect(mockDb.insert).toHaveBeenCalledWith(userBookmarks);
    expect(chain.values).toHaveBeenCalledWith({ userId: USER_ID, ...FIELDS });
  });

  it('creates nothing once the user has reached the bookmark limit', async () => {
    mockDb.$count.mockResolvedValue(BOOKMARK_LIMIT);

    await expect(createBookmark(USER_ID, FIELDS)).resolves.toBeNull();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('updates only the user’s own bookmark and returns null when there is none', async () => {
    const chain = buildChain([{ ...ROW, pinned: true }]);
    mockDb.update.mockReturnValue(chain);

    await expect(updateBookmark(USER_ID, BOOKMARK_ID, { pinned: true })).resolves.toEqual({
      ...BOOKMARK,
      pinned: true
    });
    expect(chain.set).toHaveBeenCalledWith({ pinned: true });
    expect(chain.where).toHaveBeenCalledWith(ownBookmark);

    mockDb.update.mockReturnValue(buildChain([]));
    await expect(updateBookmark(USER_ID, BOOKMARK_ID, { pinned: true })).resolves.toBeNull();
  });

  it('deletes only the user’s own bookmark and reports whether it existed', async () => {
    const chain = buildChain([{ id: BOOKMARK_ID }]);
    mockDb.delete.mockReturnValue(chain);

    await expect(deleteBookmark(USER_ID, BOOKMARK_ID)).resolves.toBe(true);
    expect(chain.where).toHaveBeenCalledWith(ownBookmark);

    mockDb.delete.mockReturnValue(buildChain([]));
    await expect(deleteBookmark(USER_ID, BOOKMARK_ID)).resolves.toBe(false);
  });
});
