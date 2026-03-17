import { logger } from '$lib/server/logging';
import { trinoQueryTotal } from '$lib/server/metrics.js';
import type { QueryResult } from 'trino-client';
import { MAX_CLIENT_ROWS, isTerminal } from '$lib/types/query.js';
import {
  type TrinoQuery,
  toQueryState,
  toQueryProgress,
  terminateQuery
} from './trino-query-model.js';

const log = logger.child({ module: 'trino-result-collector' });

/**
 * Continue iterating the Trino query result set, accumulating data into
 * the TrinoQuery. The first result has already been processed by
 * startQuery — this picks up from the iterator's current position.
 *
 * Runs as a fire-and-forget background task — never awaited by the caller.
 */
export async function collectResults(query: TrinoQuery): Promise<void> {
  const iterator = query.iterator;

  while (true) {
    if (isTerminal(query.state)) return;

    let iteratorResult: IteratorResult<QueryResult>;
    try {
      iteratorResult = await iterator.next();
    } catch (err) {
      if (isTerminal(query.state)) return;

      log.error({ err, trino_query_id: query.trinoQueryId }, 'poll failed');
      query.error = err instanceof Error ? err.message : 'Poll failed';
      terminateQuery(query, 'FAILED');
      trinoQueryTotal.inc({ outcome: 'failed' });
      return;
    }

    if (isTerminal(query.state)) return;

    const result: QueryResult = iteratorResult.value;

    log.debug({ trino_query_id: query.trinoQueryId, state: result.stats?.state }, 'polled next');

    if (result.columns && query.columns.length === 0) {
      query.columns = result.columns;
    }

    if (result.data) {
      for (const row of result.data) {
        query.rows.push(row);
      }
    }

    if (result.stats) {
      query.state = toQueryState(result.stats.state);
      query.progress = toQueryProgress(result.stats);
    }

    if (result.error) {
      query.error = result.error.message ?? 'Query failed';
      terminateQuery(query, 'FAILED');
      trinoQueryTotal.inc({ outcome: 'failed' });
      return;
    }

    // Row limit check.
    if (query.rows.length >= MAX_CLIENT_ROWS) {
      query.error = `ROW_LIMIT:${MAX_CLIENT_ROWS}`;
      try {
        await query.trinoClient.cancel(query.trinoQueryId);
      } catch (err) {
        log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel after row limit');
      }
      terminateQuery(query, 'FINISHED');
      trinoQueryTotal.inc({ outcome: 'completed' });
      return;
    }

    if (iteratorResult.done) break;
  }

  // Iterator exhausted — query complete.
  if (!isTerminal(query.state)) {
    terminateQuery(query, 'FINISHED');
    trinoQueryTotal.inc({ outcome: 'completed' });
    log.info({ trino_query_id: query.trinoQueryId }, 'query completed');
  }
}
