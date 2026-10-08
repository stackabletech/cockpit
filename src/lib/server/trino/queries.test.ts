import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TrinoClient, TrinoQueryResult } from './client.js';
import type { TrinoQuery } from './queries.js';

// Stable mock functions shared across module re-imports (each test imports a
// fresh queries.ts so its in-memory store starts empty).
const mocks = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  collectResults: vi.fn(),
  resolveTrinoPublicUrl: vi.fn(),
  queryTotalInc: vi.fn(),
  activeInc: vi.fn(),
  activeDec: vi.fn()
}));

vi.mock('$env/dynamic/private', () => ({ env: mocks.env }));
vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) }
}));
vi.mock('$lib/server/metrics.js', () => ({
  trinoQueryTotal: { inc: mocks.queryTotalInc },
  trinoActiveQueries: { inc: mocks.activeInc, dec: mocks.activeDec }
}));
vi.mock('./client.js', () => ({ resolveTrinoPublicUrl: mocks.resolveTrinoPublicUrl }));
vi.mock('./result-collector.js', () => ({ collectResults: mocks.collectResults }));

type Queries = typeof import('./queries.js');

const USER = 'u1';
const TAB = 'tab-1';
const OPTS = { user: 'alice', catalog: 'tpch', schema: 'tiny' };
const SWEEP_INTERVAL_MS = 60_000;

let q: Queries;
let client: {
  submit: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  cancelViaUri: ReturnType<typeof vi.fn>;
};

function trinoClient(): TrinoClient {
  return client as unknown as TrinoClient;
}

/** A submit response that hands off to collectResults via nextUri. */
function pending(id: string): TrinoQueryResult {
  return { id, nextUri: `http://trino/v1/statement/queued/${id}/1`, stats: { state: 'QUEUED' } };
}

/** Make collectResults drive each polled query to the given terminal state. */
function collectTo(state: 'FINISHED' | 'FAILED' | 'CANCELLED', error: string | null = null) {
  return async (query: TrinoQuery) => {
    query.columns = [{ name: 'x', type: 'integer' }];
    query.rows = [[1]];
    query.error = error;
    q.terminateQuery(query, state);
  };
}

/** Release functions of hung collectResults calls, flushed after each test. */
const pendingReleases: (() => void)[] = [];

/** Make collectResults hang until the returned release function is called. */
function hangCollect(mutate?: (query: TrinoQuery) => void) {
  let release!: () => void;
  mocks.collectResults.mockImplementationOnce((query: TrinoQuery) => {
    mutate?.(query);
    return new Promise<void>((resolve) => {
      release = resolve;
      pendingReleases.push(resolve);
    });
  });
  return () => release();
}

async function loadQueries(env: Record<string, string> = {}) {
  for (const key of Object.keys(mocks.env)) delete mocks.env[key];
  Object.assign(mocks.env, env);
  vi.resetModules();
  q = await import('./queries.js');
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  mocks.resolveTrinoPublicUrl.mockReturnValue('https://trino.example.com');
  // mockReset also drops queued *Once implementations a failed test may have left behind.
  mocks.collectResults.mockReset().mockImplementation(collectTo('FINISHED'));
  client = {
    submit: vi.fn(async (sql: string) => pending(`q-${sql}`)),
    cancel: vi.fn(async () => {}),
    cancelViaUri: vi.fn(async () => {})
  };
  await loadQueries();
});

afterEach(() => {
  // Unblock scripts left hanging by a test that failed before calling release().
  pendingReleases.splice(0).forEach((release) => release());
  vi.useRealTimers();
});

describe('mapTrinoState', () => {
  it.each(['QUEUED', 'PLANNING', 'RUNNING', 'FINISHING', 'FINISHED', 'FAILED'])(
    'passes %s through',
    (state) => {
      expect(q.mapTrinoState(state)).toBe(state);
    }
  );

  it.each([['STARTING'], ['BLOCKED'], [undefined]])('maps %s to RUNNING', (state) => {
    expect(q.mapTrinoState(state)).toBe('RUNNING');
  });
});

describe('toQueryProgress', () => {
  it('returns zeroed progress without stats', () => {
    expect(q.toQueryProgress(undefined)).toEqual({
      progressPercentage: 0,
      processedRows: 0,
      elapsedTimeMillis: 0
    });
  });

  it('defaults missing stat fields to 0', () => {
    expect(q.toQueryProgress({ state: 'RUNNING', processedRows: 42 })).toEqual({
      progressPercentage: 0,
      processedRows: 42,
      elapsedTimeMillis: 0
    });
  });
});

describe('terminateQuery', () => {
  function runningQuery(): TrinoQuery {
    return { state: 'RUNNING', completedAt: null } as TrinoQuery;
  }

  it('applies only the first termination and decrements the gauge once', () => {
    const query = runningQuery();

    q.terminateQuery(query, 'CANCELLED');
    q.terminateQuery(query, 'FAILED');

    expect(query.state).toBe('CANCELLED');
    expect(query.completedAt).toBe(Date.now());
    expect(mocks.activeDec).toHaveBeenCalledTimes(1);
  });

  it('leaves the gauge alone when decrementGauge is false', () => {
    q.terminateQuery(runningQuery(), 'FAILED', { decrementGauge: false });

    expect(mocks.activeDec).not.toHaveBeenCalled();
  });
});

describe('startScript', () => {
  it('runs statements in order and stores a result per statement', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);

    expect(client.submit.mock.calls).toEqual([
      ['SELECT 1', OPTS],
      ['SELECT 2', OPTS]
    ]);
    expect(mocks.collectResults).toHaveBeenCalledTimes(2);
    expect(mocks.activeInc).toHaveBeenCalledTimes(2);
    expect(mocks.activeDec).toHaveBeenCalledTimes(2);
    expect(mocks.queryTotalInc).toHaveBeenCalledWith({ outcome: 'submitted' });

    const snapshots = q.getQuerySnapshots(USER, TAB);
    expect(snapshots.map((s) => [s.sql, s.state])).toEqual([
      ['SELECT 1', 'FINISHED'],
      ['SELECT 2', 'FINISHED']
    ]);
  });

  it('stops at the first statement that does not finish', async () => {
    mocks.collectResults.mockImplementationOnce(collectTo('FAILED', 'Table not found'));

    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);

    expect(client.submit).toHaveBeenCalledTimes(1);
    const [snapshot] = q.getQuerySnapshots(USER, TAB);
    expect(snapshot).toMatchObject({ state: 'FAILED', error: 'Table not found' });
  });

  it('marks a statement without nextUri as finished without polling', async () => {
    client.submit.mockResolvedValueOnce({ id: 'q1', stats: { state: 'RUNNING' } });

    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);

    expect(mocks.collectResults).toHaveBeenCalledTimes(1); // only the second statement
    expect(mocks.activeInc).toHaveBeenCalledTimes(1);
    expect(mocks.queryTotalInc).toHaveBeenCalledWith({ outcome: 'completed' });
    expect(q.getQuerySnapshots(USER, TAB).map((s) => s.state)).toEqual(['FINISHED', 'FINISHED']);
  });

  it('keeps results returned directly in the submit response', async () => {
    client.submit.mockResolvedValueOnce({
      id: 'q1',
      columns: [{ name: 'n', type: 'bigint' }],
      data: [[7]],
      stats: { state: 'FINISHED', processedRows: 1 }
    });

    await q.startScript(trinoClient(), USER, TAB, ['SELECT 7'], OPTS);

    expect(mocks.collectResults).not.toHaveBeenCalled();
    const [snapshot] = q.getQuerySnapshots(USER, TAB);
    expect(snapshot).toMatchObject({
      state: 'FINISHED',
      columns: [{ name: 'n', type: 'bigint' }],
      rows: [[7]],
      progress: { processedRows: 1 }
    });
  });

  it('fails and stops on an error in the submit response', async () => {
    client.submit.mockResolvedValueOnce({
      id: 'q1',
      error: { message: 'line 1:1: mismatched input' }
    });

    await q.startScript(trinoClient(), USER, TAB, ['SELEC 1', 'SELECT 2'], OPTS);

    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(mocks.collectResults).not.toHaveBeenCalled();
    expect(mocks.activeDec).not.toHaveBeenCalled();
    expect(mocks.queryTotalInc).toHaveBeenCalledWith({ outcome: 'failed' });
    const [snapshot] = q.getQuerySnapshots(USER, TAB);
    expect(snapshot).toMatchObject({ state: 'FAILED', error: 'line 1:1: mismatched input' });
  });

  it('falls back to a generic message when the submit error has none', async () => {
    client.submit.mockResolvedValueOnce({ id: 'q1', error: {} });

    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    expect(q.getQuerySnapshots(USER, TAB)[0].error).toBe('Query failed');
  });

  it('stops without storing a result when submit throws', async () => {
    client.submit.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(
      q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS)
    ).resolves.toBeUndefined();

    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(mocks.queryTotalInc).toHaveBeenCalledWith({ outcome: 'failed' });
    expect(q.getQuerySnapshots(USER, TAB)).toEqual([]);
  });

  it('stops when Trino returns no query ID', async () => {
    client.submit.mockResolvedValueOnce({ id: '' });

    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);

    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(q.getQuerySnapshots(USER, TAB)).toEqual([]);
  });

  it('fails the query when the poll loop crashes', async () => {
    mocks.collectResults.mockRejectedValueOnce(new Error('unexpected'));

    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);

    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(mocks.activeDec).toHaveBeenCalledTimes(1);
    expect(mocks.queryTotalInc).toHaveBeenCalledWith({ outcome: 'failed' });
    expect(q.getQuerySnapshots(USER, TAB)[0]).toMatchObject({
      state: 'FAILED',
      error: 'Internal poll error'
    });
  });

  it('replaces earlier results for the same tab', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 3'], OPTS);

    expect(q.getQuerySnapshots(USER, TAB).map((s) => s.sql)).toEqual(['SELECT 3']);
  });

  it('cancels a still-running query before starting a new script on the tab', async () => {
    const release = hangCollect();
    const first = q.startScript(trinoClient(), USER, TAB, ['SELECT slow'], OPTS);
    await vi.waitFor(() => expect(mocks.collectResults).toHaveBeenCalled());

    await q.startScript(trinoClient(), USER, TAB, ['SELECT fast'], OPTS);
    release();
    await first;

    expect(client.cancelViaUri).toHaveBeenCalledWith(pending('q-SELECT slow').nextUri, 'alice');
    expect(q.getQuerySnapshots(USER, TAB).map((s) => s.sql)).toEqual(['SELECT fast']);
  });

  it('keeps tabs and users isolated from each other', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);
    await q.startScript(trinoClient(), USER, 'tab-2', ['SELECT 2'], OPTS);
    await q.startScript(trinoClient(), 'u2', TAB, ['SELECT 3'], OPTS);

    expect(q.getQuerySnapshots(USER, TAB).map((s) => s.sql)).toEqual(['SELECT 1']);
    expect(q.getQuerySnapshots(USER, 'tab-2').map((s) => s.sql)).toEqual(['SELECT 2']);
    expect(q.getQuerySnapshots('u2', TAB).map((s) => s.sql)).toEqual(['SELECT 3']);
  });
});

describe('getQuerySnapshots', () => {
  it('returns an empty list for an unknown tab', () => {
    expect(q.getQuerySnapshots(USER, 'unknown')).toEqual([]);
  });

  it('includes rows and columns unless lightweight', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    expect(q.getQuerySnapshots(USER, TAB)[0]).toMatchObject({
      columns: [{ name: 'x', type: 'integer' }],
      rows: [[1]]
    });
    expect(q.getQuerySnapshots(USER, TAB, true)[0]).toMatchObject({ columns: [], rows: [] });
  });

  it('links to the Trino UI via the public URL', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    expect(q.getQuerySnapshots(USER, TAB)[0].trinoQueryUrl).toBe(
      'https://trino.example.com/ui/query.html?q-SELECT 1'
    );
    expect(mocks.resolveTrinoPublicUrl).toHaveBeenCalledWith(USER);
  });

  it('omits the Trino UI link without a public URL', async () => {
    mocks.resolveTrinoPublicUrl.mockReturnValue(null);
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    expect(q.getQuerySnapshots(USER, TAB)[0].trinoQueryUrl).toBeNull();
  });
});

describe('getAllQuerySummaries', () => {
  it('returns an empty object for a user without queries', () => {
    expect(q.getAllQuerySummaries(USER)).toEqual({});
  });

  it('groups lightweight snapshots by tab', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);
    await q.startScript(trinoClient(), USER, 'tab-2', ['SELECT 3'], OPTS);

    const summaries = q.getAllQuerySummaries(USER);

    expect(Object.keys(summaries)).toEqual([TAB, 'tab-2']);
    expect(summaries[TAB].map((s) => s.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(summaries[TAB][0]).toMatchObject({ columns: [], rows: [] });
  });
});

describe('removeTabQuery', () => {
  it('drops the tab and leaves other tabs intact', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);
    await q.startScript(trinoClient(), USER, 'tab-2', ['SELECT 2'], OPTS);

    q.removeTabQuery(USER, TAB);

    expect(Object.keys(q.getAllQuerySummaries(USER))).toEqual(['tab-2']);
  });

  it('drops the user entry once the last tab is removed', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    q.removeTabQuery(USER, TAB);

    expect(q.getAllQuerySummaries(USER)).toEqual({});
  });

  it('is a no-op for an unknown user', () => {
    expect(() => q.removeTabQuery('nobody', TAB)).not.toThrow();
  });
});

describe('cancelQuery', () => {
  it('returns false when the tab has no queries', async () => {
    expect(await q.cancelQuery(USER, TAB)).toBe(false);
  });

  it('returns false when the last query is already terminal', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    expect(await q.cancelQuery(USER, TAB)).toBe(false);
    expect(client.cancelViaUri).not.toHaveBeenCalled();
    expect(client.cancel).not.toHaveBeenCalled();
  });

  it('cancels via nextUri while results are still pending', async () => {
    const release = hangCollect();
    const script = q.startScript(trinoClient(), USER, TAB, ['SELECT 1', 'SELECT 2'], OPTS);
    await vi.waitFor(() => expect(mocks.collectResults).toHaveBeenCalled());

    expect(await q.cancelQuery(USER, TAB)).toBe(true);
    release();
    await script;

    expect(client.cancelViaUri).toHaveBeenCalledWith(pending('q-SELECT 1').nextUri, 'alice');
    expect(client.cancel).not.toHaveBeenCalled();
    expect(mocks.activeDec).toHaveBeenCalledTimes(1);
    expect(mocks.queryTotalInc).toHaveBeenCalledWith({ outcome: 'cancelled' });
    // The script does not continue with the next statement after cancellation.
    expect(client.submit).toHaveBeenCalledTimes(1);
    expect(q.getQuerySnapshots(USER, TAB).map((s) => s.state)).toEqual(['CANCELLED']);
  });

  it('cancels by query ID when there is no nextUri', async () => {
    const release = hangCollect((query) => (query.nextUri = undefined));
    const script = q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);
    await vi.waitFor(() => expect(mocks.collectResults).toHaveBeenCalled());

    await q.cancelQuery(USER, TAB);
    release();
    await script;

    expect(client.cancel).toHaveBeenCalledWith('q-SELECT 1', 'alice');
    expect(client.cancelViaUri).not.toHaveBeenCalled();
  });

  it('still marks the query cancelled when Trino rejects the cancel', async () => {
    client.cancelViaUri.mockRejectedValueOnce(new Error('503'));
    const release = hangCollect();
    const script = q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);
    await vi.waitFor(() => expect(mocks.collectResults).toHaveBeenCalled());

    expect(await q.cancelQuery(USER, TAB)).toBe(true);
    release();
    await script;

    expect(q.getQuerySnapshots(USER, TAB)[0].state).toBe('CANCELLED');
  });
});

describe('expired query sweep', () => {
  const DEFAULT_TTL_MS = 1800 * 1000;

  it('evicts finished tabs that have not been accessed within the TTL', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    vi.advanceTimersByTime(DEFAULT_TTL_MS - SWEEP_INTERVAL_MS);
    expect(Object.keys(q.getAllQuerySummaries(USER))).toEqual([TAB]);

    vi.advanceTimersByTime(SWEEP_INTERVAL_MS);
    expect(q.getAllQuerySummaries(USER)).toEqual({});
  });

  it('keeps tabs that were polled recently', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    vi.advanceTimersByTime(DEFAULT_TTL_MS / 2);
    q.getQuerySnapshots(USER, TAB); // a client poll refreshes the access time
    vi.advanceTimersByTime(DEFAULT_TTL_MS / 2 + SWEEP_INTERVAL_MS);

    expect(Object.keys(q.getAllQuerySummaries(USER))).toEqual([TAB]);
  });

  it('never evicts a tab with an active query', async () => {
    const release = hangCollect();
    const script = q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);
    await vi.waitFor(() => expect(mocks.collectResults).toHaveBeenCalled());

    vi.advanceTimersByTime(DEFAULT_TTL_MS * 2);

    expect(Object.keys(q.getAllQuerySummaries(USER))).toEqual([TAB]);
    release();
    await script;
  });

  it('only evicts the expired tabs of a user', async () => {
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);
    vi.advanceTimersByTime(DEFAULT_TTL_MS / 2);
    await q.startScript(trinoClient(), USER, 'tab-2', ['SELECT 2'], OPTS);

    vi.advanceTimersByTime(DEFAULT_TTL_MS / 2 + SWEEP_INTERVAL_MS);

    expect(Object.keys(q.getAllQuerySummaries(USER))).toEqual(['tab-2']);
  });

  it('honours STACKABLE_COCKPIT_QUERY_TTL', async () => {
    await loadQueries({ STACKABLE_COCKPIT_QUERY_TTL: '120' });
    await q.startScript(trinoClient(), USER, TAB, ['SELECT 1'], OPTS);

    vi.advanceTimersByTime(60_000);
    expect(Object.keys(q.getAllQuerySummaries(USER))).toEqual([TAB]);

    vi.advanceTimersByTime(120_000);
    expect(q.getAllQuerySummaries(USER)).toEqual({});
  });
});
