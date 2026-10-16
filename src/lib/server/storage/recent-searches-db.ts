import { createHash } from 'node:crypto';
import { and, eq, desc, notInArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db.js';
import { userRecentSearches } from '$lib/server/schema.js';
import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'recent-searches-db' });

/** Maximum number of recent searches kept per user and connection. */
export const RECENT_SEARCHES_CAP = 20;

/** The advanced options recorded alongside a recent search. */
export interface RecentSearchOptions {
  useRegex: boolean;
  excludePatterns: string[];
  searchPath: string;
  maxDepth: number | null;
}

/** A single stored recent search: the query and advanced options plus the
 *  ordered list of buckets it ran against. Only `maxDepth` can be NULL
 *  (meaning "no limit"). */
export interface RecentSearch {
  buckets: string[];
  query: string;
  useRegex: boolean;
  excludePatterns: string[];
  searchPath: string;
  maxDepth: number | null;
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
    .select({
      buckets: userRecentSearches.buckets,
      query: userRecentSearches.query,
      useRegex: userRecentSearches.useRegex,
      excludePatterns: userRecentSearches.excludePatterns,
      searchPath: userRecentSearches.searchPath,
      maxDepth: userRecentSearches.maxDepth
    })
    .from(userRecentSearches)
    .where(
      and(eq(userRecentSearches.userId, userId), eq(userRecentSearches.connectionId, connectionId))
    )
    .orderBy(desc(userRecentSearches.updatedAt));

  log.debug({ user_id: userId, connection_id: connectionId }, 'listed recent storage searches');
  return rows;
}

/**
 * Identity of a recent search: a SHA-256 hash of the sorted buckets, query and
 * advanced options. Used as the unique key instead of the raw values, which
 * can be too large for a btree index.
 */
export function recentSearchKey(
  sortedBuckets: string[],
  query: string,
  options: RecentSearchOptions
): string {
  const identity = JSON.stringify([
    sortedBuckets,
    query,
    options.useRegex,
    options.excludePatterns,
    options.searchPath,
    options.maxDepth
  ]);
  return createHash('sha256').update(identity, 'utf8').digest('hex');
}

/**
 * Record a search for a user and connection. If an identical search — same
 * buckets, query and advanced options — already exists it is bumped to the top,
 * otherwise a new row is inserted. Afterwards the history is pruned down to
 * RECENT_SEARCHES_CAP entries.
 *
 * `buckets` is stored sorted so the unique key is independent of the order in
 * which the user selected the buckets.
 */
export async function recordRecentSearch(
  userId: string,
  connectionId: string,
  buckets: string[],
  query: string,
  options: RecentSearchOptions
): Promise<void> {
  const sortedBuckets = [...new Set(buckets)].sort();
  const searchKey = recentSearchKey(sortedBuckets, query, options);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${JSON.stringify([userId, connectionId])}, 0))`
    );
    const now = sql`clock_timestamp()`;

    // Upsert on the unique (user, connection, search key) key.
    await tx
      .insert(userRecentSearches)
      .values({
        userId,
        connectionId,
        buckets: sortedBuckets,
        query,
        useRegex: options.useRegex,
        excludePatterns: options.excludePatterns,
        searchPath: options.searchPath,
        maxDepth: options.maxDepth,
        searchKey,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [
          userRecentSearches.userId,
          userRecentSearches.connectionId,
          userRecentSearches.searchKey
        ],
        set: { updatedAt: now }
      });

    // Prune to the most recent RECENT_SEARCHES_CAP rows for this user and connection.
    const keepIds = tx
      .select({ id: userRecentSearches.id })
      .from(userRecentSearches)
      .where(
        and(
          eq(userRecentSearches.userId, userId),
          eq(userRecentSearches.connectionId, connectionId)
        )
      )
      .orderBy(desc(userRecentSearches.updatedAt))
      .limit(RECENT_SEARCHES_CAP);

    await tx
      .delete(userRecentSearches)
      .where(
        and(
          eq(userRecentSearches.userId, userId),
          eq(userRecentSearches.connectionId, connectionId),
          notInArray(userRecentSearches.id, keepIds)
        )
      );
  });
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
