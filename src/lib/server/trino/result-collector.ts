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
 * Follows every nextUri so the UI receives every state transition
 * (QUEUED → PLANNING → RUNNING → FINISHED).
 *
 * Runs as a fire-and-forget background task — never awaited by the caller.
 */
export async function collectResults(query: TrinoQuery): Promise<void> {
  let nextUri = query.nextUri;

  while (nextUri) {
    if (isTerminal(query.state)) return;

    let result;
    try {
      result = await query.client.poll(nextUri);
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
      query.state = mapTrinoState(result.stats.state);
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
        await query.client.cancel(query.trinoQueryId);
      } catch (err) {
        log.warn({ err, trino_query_id: query.trinoQueryId }, 'failed to cancel after row limit');
      }
      terminateQuery(query, 'FINISHED');
      trinoQueryTotal.inc({ outcome: 'completed' });
      return;
    }

    nextUri = result.nextUri;
  }

  // No more pages — query complete.
  if (!isTerminal(query.state)) {
    terminateQuery(query, 'FINISHED');
    trinoQueryTotal.inc({ outcome: 'completed' });
    log.info({ trino_query_id: query.trinoQueryId }, 'query completed');
  }
}
