import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) }
}));
vi.mock('$lib/server/metrics.js', () => ({
  trinoQueryTotal: { inc: vi.fn() },
  trinoActiveQueries: { inc: vi.fn(), dec: vi.fn() }
}));

import { collectResults } from './result-collector.js';
import { MAX_CLIENT_ROWS, INITIAL_PROGRESS } from '$lib/types/query.js';
import type { TrinoQuery } from './queries.js';

/** Just over half the limit, so two pages cross MAX_CLIENT_ROWS. */
function page(): unknown[][] {
  const count = Math.ceil(MAX_CLIENT_ROWS / 2) + 1;
  return Array.from({ length: count }, () => [1]);
}

function makeQuery(client: Partial<TrinoQuery['client']>): TrinoQuery {
  return {
    trinoQueryId: 'q1',
    state: 'RUNNING',
    progress: INITIAL_PROGRESS,
    columns: [],
    rows: [],
    error: null,
    sql: 'SELECT * FROM big',
    startedAt: 0,
    nextUri: 'http://trino/next-1',
    client: client as TrinoQuery['client'],
    userId: 'u',
    trinoUser: 'alice',
    completedAt: null
  };
}

describe('collectResults row limit', () => {
  it('cancels via the live nextUri and finishes when MAX_CLIENT_ROWS is exceeded', async () => {
    const cancelViaUri = vi.fn(async () => {});
    const cancel = vi.fn(async () => {});
    let call = 0;
    const poll = vi.fn(async () => {
      call++;
      return {
        id: 'q1',
        data: page(),
        nextUri: `http://trino/next-${call + 1}`,
        stats: { state: 'RUNNING' }
      };
    });

    const query = makeQuery({ poll, cancelViaUri, cancel });
    await collectResults(query);

    expect(cancelViaUri).toHaveBeenCalledWith('http://trino/next-3', 'alice');
    expect(cancel).not.toHaveBeenCalled();
    expect(query.error).toBe(`ROW_LIMIT:${MAX_CLIENT_ROWS}`);
    expect(query.state).toBe('FINISHED');
    expect(query.rows.length).toBeGreaterThanOrEqual(MAX_CLIENT_ROWS);
  });

  it('falls back to cancel(queryId) when the crossing page has no nextUri', async () => {
    const cancelViaUri = vi.fn(async () => {});
    const cancel = vi.fn(async () => {});
    const poll = vi.fn(async () => ({
      id: 'q1',
      data: Array.from({ length: MAX_CLIENT_ROWS + 1 }, () => [1]),
      nextUri: undefined,
      stats: { state: 'RUNNING' }
    }));

    const query = makeQuery({ poll, cancelViaUri, cancel });
    await collectResults(query);

    expect(cancelViaUri).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith('q1', 'alice');
    expect(query.error).toBe(`ROW_LIMIT:${MAX_CLIENT_ROWS}`);
    expect(query.state).toBe('FINISHED');
  });
});
