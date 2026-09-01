import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { CasingCache } from 'drizzle-orm/casing';
import { userRecentSearches } from '$lib/server/schema.js';
import {
  listRecentSearches,
  recordRecentSearch,
  clearRecentSearches,
  RECENT_SEARCHES_CAP
} from './recent-searches-db.js';

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ trace: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }) }
}));

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn()
  }
}));

vi.mock('$lib/server/db.js', () => ({ db: mockDb }));

type ChainFn = (...args: unknown[]) => MockChain;

/** Mocked Drizzle query builder: every terminal call returns the same chain,
 *  which is thenable (resolving to `result`) and acts as a SQLWrapper when
 *  used as a subquery — its `.limit()` value is rendered into `getSQL()`. */
interface MockChain {
  from: Mock<ChainFn>;
  where: Mock<ChainFn>;
  orderBy: Mock<ChainFn>;
  limit: Mock<ChainFn>;
  values: Mock<ChainFn>;
  onConflictDoUpdate: Mock<ChainFn>;
  returning: Mock<ChainFn>;
  then: (resolve: (value: unknown) => unknown) => Promise<unknown>;
  getSQL: () => SQL;
}

function buildChain(result: unknown, subquerySQL: string): MockChain {
  let limitValue: number | undefined;
  const chain: MockChain = {
    from: vi.fn<ChainFn>(() => chain),
    where: vi.fn<ChainFn>(() => chain),
    orderBy: vi.fn<ChainFn>(() => chain),
    limit: vi.fn<ChainFn>((...args: unknown[]) => {
      limitValue = args[0] as number;
      return chain;
    }),
    values: vi.fn<ChainFn>(() => chain),
    onConflictDoUpdate: vi.fn<ChainFn>(() => chain),
    returning: vi.fn<ChainFn>(() => chain),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    getSQL: () =>
      sql`${sql.raw(`${subquerySQL}${limitValue !== undefined ? ` limit ${limitValue}` : ''}`)}`
  };
  return chain;
}

/** Serialise a Drizzle SQL wrapper the way the Postgres dialect would. */
function toQuery(condition: unknown) {
  const config = {
    escapeName: (n: string) => `"${n}"`,
    escapeParam: (index: number) => `$${index + 1}`,
    casing: new CasingCache('camelCase'),
    paramStartIndex: { value: 0 },
    inlineParams: false
  };
  return (
    condition as { toQuery: (config: unknown) => { sql: string; params: unknown[] } }
  ).toQuery(config);
}

const USER_ID = 'user-1';
const CONNECTION_ID = '00000000-0000-0000-0000-000000000001';

describe('recent-searches-db', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('listRecentSearches', () => {
    it('selects bucket+query for the user+connection, newest first', async () => {
      const rows = [
        { bucket: 'b1', query: 'q2' },
        { bucket: 'b1', query: 'q1' }
      ];
      mockDb.select.mockReturnValue(buildChain(rows, 'select id from user_recent_searches'));

      const result = await listRecentSearches(USER_ID, CONNECTION_ID);

      expect(mockDb.select).toHaveBeenCalledWith({
        bucket: userRecentSearches.bucket,
        query: userRecentSearches.query
      });

      const selectChain = mockDb.select.mock.results[0].value;
      expect(selectChain.from).toHaveBeenCalledWith(userRecentSearches);

      const whereSql = toQuery(selectChain.where.mock.calls[0][0]);
      expect(whereSql.sql).toContain('"user_recent_searches"."user_id" = $1');
      expect(whereSql.sql).toContain('"user_recent_searches"."connection_id" = $2');
      expect(whereSql.params).toEqual([USER_ID, CONNECTION_ID]);

      expect(selectChain.orderBy).toHaveBeenCalledTimes(1);
      expect(toQuery(selectChain.orderBy.mock.calls[0][0]).sql).toBe(
        '"user_recent_searches"."updated_at" desc'
      );

      expect(result).toEqual(rows);
    });
  });

  describe('recordRecentSearch', () => {
    it('upserts on the unique key, bumping updated_at, then prunes to the cap', async () => {
      const insertChain = buildChain(undefined, '');
      const subqueryChain = buildChain(undefined, 'select id from user_recent_searches');
      const deleteChain = buildChain(undefined, '');

      mockDb.insert.mockReturnValue(insertChain);
      mockDb.select.mockReturnValue(subqueryChain);
      mockDb.delete.mockReturnValue(deleteChain);

      const before = Date.now();
      await recordRecentSearch(USER_ID, CONNECTION_ID, 'bucket-1', 'query-1');
      const after = Date.now();

      expect(mockDb.insert).toHaveBeenCalledWith(userRecentSearches);

      const insertValues = insertChain.values.mock.calls[0][0] as {
        userId: string;
        connectionId: string;
        bucket: string;
        query: string;
        updatedAt: Date;
      };
      expect(insertValues).toMatchObject({
        userId: USER_ID,
        connectionId: CONNECTION_ID,
        bucket: 'bucket-1',
        query: 'query-1'
      });
      expect(insertValues.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(insertValues.updatedAt.getTime()).toBeLessThanOrEqual(after);

      const conflict = insertChain.onConflictDoUpdate.mock.calls[0][0] as {
        target: unknown[];
        set: { updatedAt: Date };
      };
      expect(conflict.target).toEqual([
        userRecentSearches.userId,
        userRecentSearches.connectionId,
        userRecentSearches.bucket,
        userRecentSearches.query
      ]);

      expect(conflict.set.updatedAt.getTime()).toBeGreaterThanOrEqual(before);
      expect(conflict.set.updatedAt.getTime()).toBeLessThanOrEqual(after);

      // Prune: subquery limited to the cap, delete excludes those ids.
      expect(subqueryChain.limit).toHaveBeenCalledWith(RECENT_SEARCHES_CAP);
      expect(subqueryChain.orderBy).toHaveBeenCalledTimes(1);
      expect(mockDb.delete).toHaveBeenCalledWith(userRecentSearches);

      const deleteWhereSql = toQuery(deleteChain.where.mock.calls[0][0]);
      expect(deleteWhereSql.sql).toContain('"user_recent_searches"."user_id" = $1');
      expect(deleteWhereSql.sql).toContain('"user_recent_searches"."connection_id" = $2');
      expect(deleteWhereSql.sql).toContain('"user_recent_searches"."id" not in');
      expect(deleteWhereSql.sql).toContain('limit 20');
      expect(deleteWhereSql.params).toEqual([USER_ID, CONNECTION_ID]);
    });

    it('uses a later timestamp for consecutive records in the same millisecond', async () => {
      const insertChain = buildChain(undefined, '');
      const subqueryChain = buildChain(undefined, 'select id from user_recent_searches');
      const deleteChain = buildChain(undefined, '');
      mockDb.insert.mockReturnValue(insertChain);
      mockDb.select.mockReturnValue(subqueryChain);
      mockDb.delete.mockReturnValue(deleteChain);
      vi.spyOn(Date, 'now').mockReturnValue(1_000);

      await recordRecentSearch(USER_ID, CONNECTION_ID, 'bucket-1', 'query-1');
      const firstTimestamp = (insertChain.values.mock.calls[0][0] as { updatedAt: Date }).updatedAt;

      await recordRecentSearch(USER_ID, CONNECTION_ID, 'bucket-1', 'query-2');
      const secondTimestamp = (insertChain.values.mock.calls[1][0] as { updatedAt: Date })
        .updatedAt;

      expect(secondTimestamp.getTime()).toBeGreaterThan(firstTimestamp.getTime());
    });
  });

  describe('clearRecentSearches', () => {
    it('deletes all rows for the user+connection', async () => {
      const deleteChain = buildChain(undefined, '');
      mockDb.delete.mockReturnValue(deleteChain);

      await clearRecentSearches(USER_ID, CONNECTION_ID);

      expect(mockDb.delete).toHaveBeenCalledWith(userRecentSearches);
      expect(mockDb.select).not.toHaveBeenCalled();

      const whereSql = toQuery(deleteChain.where.mock.calls[0][0]);
      expect(whereSql.sql).toContain('"user_recent_searches"."user_id" = $1');
      expect(whereSql.sql).toContain('"user_recent_searches"."connection_id" = $2');
      expect(whereSql.params).toEqual([USER_ID, CONNECTION_ID]);
    });
  });
});
