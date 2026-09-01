import { and, eq, desc, notInArray } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userRecentSearches } from '$lib/server/schema.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'recent-searches-db' });
let lastRecordedAt = 0;

/** Maximum number of recent searches kept per user and connection. */
export const RECENT_SEARCHES_CAP = 20;

/** A single stored recent search. */
export interface RecentSearch {
  bucket: string;
  query: string;
}

/**
 * List the most recent searches for a user and connection,
 * newest first.
 */
export async function listRecentSearches(
  userId: string,
  connectionId: string
): Promise<RecentSearch[]> {
  const rows = await db
    .select({ bucket: userRecentSearches.bucket, query: userRecentSearches.query })
    .from(userRecentSearches)
    .where(
      and(eq(userRecentSearches.userId, userId), eq(userRecentSearches.connectionId, connectionId))
    )
    .orderBy(desc(userRecentSearches.updatedAt));

  log.debug({ user_id: userId, connection_id: connectionId }, 'listed recent storage searches');
  return rows;
}

/**
 * Record a search for a user and connection. If an identical search already
 * exists it is bumped to the top, otherwise a new row is inserted. Afterwards
 * the history is pruned down to RECENT_SEARCHES_CAP entries.
 */
export async function recordRecentSearch(
  userId: string,
  connectionId: string,
  bucket: string,
  query: string
): Promise<void> {
  // JavaScript dates have millisecond precision. Keep writes strictly ordered
  // so replaying a search always moves it ahead of an earlier same-ms record.
  lastRecordedAt = Math.max(Date.now(), lastRecordedAt + 1);
  const now = new Date(lastRecordedAt);

  // Upsert on the unique (user, connection, bucket, query) key.
  await db
    .insert(userRecentSearches)
    .values({ userId, connectionId, bucket, query, updatedAt: now })
    .onConflictDoUpdate({
      target: [
        userRecentSearches.userId,
        userRecentSearches.connectionId,
        userRecentSearches.bucket,
        userRecentSearches.query
      ],
      set: { updatedAt: now }
    });

  // Prune to the most recent RECENT_SEARCHES_CAP rows for this user and connection.
  const keepIds = db
    .select({ id: userRecentSearches.id })
    .from(userRecentSearches)
    .where(
      and(eq(userRecentSearches.userId, userId), eq(userRecentSearches.connectionId, connectionId))
    )
    .orderBy(desc(userRecentSearches.updatedAt))
    .limit(RECENT_SEARCHES_CAP);

  await db
    .delete(userRecentSearches)
    .where(
      and(
        eq(userRecentSearches.userId, userId),
        eq(userRecentSearches.connectionId, connectionId),
        notInArray(userRecentSearches.id, keepIds)
      )
    );

  log.info({ user_id: userId, connection_id: connectionId }, 'recorded recent storage search');
}

/**
 * Remove all recent searches for a user and connection.
 */
export async function clearRecentSearches(userId: string, connectionId: string): Promise<void> {
  await db
    .delete(userRecentSearches)
    .where(
      and(eq(userRecentSearches.userId, userId), eq(userRecentSearches.connectionId, connectionId))
    );
  log.debug({ user_id: userId, connection_id: connectionId }, 'cleared recent storage searches');
}
