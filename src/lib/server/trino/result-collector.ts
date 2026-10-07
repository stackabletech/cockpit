import { logger } from '$lib/server/logging';
import { trinoQueryTotal } from '$lib/server/metrics.js';
import { MAX_CLIENT_ROWS, isTerminal } from '$lib/types/query.js';
import { type TrinoQuery, mapTrinoState, toQueryProgress, terminateQuery } from './queries.js';

const log = logger.child({ module: 'trino-result-collector' });

/**
 * Poll the Trino REST API page-by-page, accumulating data into
 * the TrinoQuery. The first result has already been processed by
 * startQuery — this picks up from the initial response's nextUri.
 *
 * Terminal state (FINISHED/FAILED) is deferred until all pages are drained,
 * so the browser keeps polling and receives all rows.
 *
 * Runs as a fire-and-forget background task — never awaited by the caller.
 */
export async function collectResults(query: TrinoQuery): Promise<void> {
  let nextUri = query.nextUri;

  while (nextUri) {
    // The await below is a yield point where external cancellation can land.
    // Check before (skip the call) and after (discard stale result).
    if (isTerminal(query.state)) return;

    let result;
    try {
      result = await query.client.poll(nextUri, { user: query.trinoUser });
    } catch (err) {
      if (isTerminal(query.state)) return;

      log.error({ err, trino_query_id: query.trinoQueryId }, 'poll failed');
      query.error = err instanceof Error ? err.message : 'Poll failed';
      terminateQuery(query, 'FAILED');
      trinoQueryTotal.inc({ outcome: 'failed' });
      return;
    }

    if (isTerminal(query.state)) return;

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
      const mappedState = mapTrinoState(result.stats.state);
      // Don't expose a terminal state until all result pages have been collected,
      // otherwise the browser stops polling and misses trailing rows.
      if (!isTerminal(mappedState)) {
        query.state = mappedState;
      }
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
        if (result.nextUri) {
          await query.client.cancelViaUri(result.nextUri, query.trinoUser);
        } else {
          await query.client.cancel(query.trinoQueryId, query.trinoUser);
        }
      } catch (err) {
        log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel after row limit');
      }
      terminateQuery(query, 'FINISHED');
      trinoQueryTotal.inc({ outcome: 'completed' });
      return;
    }

    nextUri = result.nextUri;
    query.nextUri = nextUri;
  }

  // All pages drained. Safe even if cancelled concurrently (terminateQuery
  // is idempotent).
  terminateQuery(query, 'FINISHED');
  trinoQueryTotal.inc({ outcome: 'completed' });
  log.info({ trino_query_id: query.trinoQueryId }, 'query completed');
}
