import { and, asc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userBookmarks } from '$lib/server/schema.js';
import { logger } from '$lib/server/logging';
import type { Bookmark, BookmarkUpdate } from '$lib/dashboard/types.js';

const log = logger.child({ module: 'bookmarks-db' });

const bookmarkColumns = {
  id: userBookmarks.id,
  productId: userBookmarks.productId,
  name: userBookmarks.name,
  environment: userBookmarks.environment,
  url: userBookmarks.url,
  pinned: userBookmarks.pinned,
  createdAt: userBookmarks.createdAt
};

type BookmarkRow = { createdAt: Date } & Omit<Bookmark, 'createdAt'>;

function toBookmark(row: BookmarkRow): Bookmark {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** List a user's bookmarks, oldest first. */
export async function listBookmarks(userId: string): Promise<Bookmark[]> {
  const rows = await db
    .select(bookmarkColumns)
    .from(userBookmarks)
    .where(eq(userBookmarks.userId, userId))
    .orderBy(asc(userBookmarks.createdAt), asc(userBookmarks.id));

  log.debug({ user_id: userId, bookmark_count: rows.length }, 'listed bookmarks');
  return rows.map(toBookmark);
}

/** Create a bookmark for a user and return it with its generated id and timestamp. */
export async function createBookmark(
  userId: string,
  bookmark: Omit<Bookmark, 'id' | 'createdAt'>
): Promise<Bookmark> {
  const [row] = await db
    .insert(userBookmarks)
    .values({ userId, ...bookmark })
    .returning(bookmarkColumns);

  log.debug({ user_id: userId, bookmark_id: row.id }, 'created bookmark');
  return toBookmark(row);
}

/**
 * Update fields of a user's bookmark. Returns the updated bookmark, or null if
 * the user has no bookmark with this id.
 */
export async function updateBookmark(
  userId: string,
  id: string,
  update: BookmarkUpdate
): Promise<Bookmark | null> {
  const [row] = await db
    .update(userBookmarks)
    .set(update)
    .where(and(eq(userBookmarks.userId, userId), eq(userBookmarks.id, id)))
    .returning(bookmarkColumns);

  if (!row) {
    log.debug({ user_id: userId, bookmark_id: id }, 'bookmark to update not found');
    return null;
  }
  log.debug({ user_id: userId, bookmark_id: id }, 'updated bookmark');
  return toBookmark(row);
}

/** Delete a user's bookmark. Returns false if the user has no bookmark with this id. */
export async function deleteBookmark(userId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(userBookmarks)
    .where(and(eq(userBookmarks.userId, userId), eq(userBookmarks.id, id)))
    .returning({ id: userBookmarks.id });

  if (rows.length === 0) {
    log.debug({ user_id: userId, bookmark_id: id }, 'bookmark to delete not found');
    return false;
  }
  log.debug({ user_id: userId, bookmark_id: id }, 'deleted bookmark');
  return true;
}
