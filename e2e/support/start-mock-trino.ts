import * as http from 'node:http';
import { MOCK_TRINO_PORT } from './mock-trino';

/** SQL substring → fixture response. First match wins; fallback is a 3-row success. */
const routes: [string, object][] = [
  [
    'SHOW CATALOGS',
    {
      id: 'q-catalogs',
      columns: [{ name: 'Catalog', type: 'varchar' }],
      data: [['tpch'], ['system']],
      stats: { state: 'FINISHED' }
    }
  ],
  [
    'SHOW SCHEMAS',
    {
      id: 'q-schemas',
      columns: [{ name: 'Schema', type: 'varchar' }],
      data: [['information_schema'], ['sf1'], ['sf100']],
      stats: { state: 'FINISHED' }
    }
  ],
  [
    'information_schema.tables',
    {
      id: 'q-tables',
      columns: [
        { name: 'table_name', type: 'varchar' },
        { name: 'table_type', type: 'varchar' }
      ],
      data: [
        ['customer', 'BASE TABLE'],
        ['orders', 'BASE TABLE'],
        ['customer_view', 'VIEW'],
        ['customer_mv', 'MATERIALIZED VIEW']
      ],
      stats: { state: 'FINISHED' }
    }
  ],
  [
    'DESCRIBE',
    {
      id: 'q-columns',
      columns: [
        { name: 'Column', type: 'varchar' },
        { name: 'Type', type: 'varchar' },
        { name: 'Extra', type: 'varchar' },
        { name: 'Comment', type: 'varchar' }
      ],
      data: [
        ['custkey', 'bigint', '', ''],
        ['name', 'varchar', '', ''],
        ['address', 'varchar', '', '']
      ],
      stats: { state: 'FINISHED' }
    }
  ],
  [
    'SHOULD_ERROR',
    {
      id: 'q-err',
      error: { message: 'syntax error at position 7', errorCode: 1 },
      stats: { state: 'FAILED' }
    }
  ],
  [
    'FROM large_table',
    {
      id: 'q-pages',
      columns: [
        { name: 'id', type: 'integer' },
        { name: 'name', type: 'varchar' }
      ],
      data: Array.from({ length: 60 }, (_, i) => [i + 1, `Row ${i + 1}`]),
      stats: { state: 'FINISHED' }
    }
  ],
  [
    'FROM nullable_table',
    {
      id: 'q-null',
      columns: [{ name: 'value', type: 'varchar' }],
      data: [[null], ['hello']],
      stats: { state: 'FINISHED' }
    }
  ]
];

const DEFAULT_RESPONSE = {
  id: 'q-default',
  columns: [
    { name: 'id', type: 'integer' },
    { name: 'name', type: 'varchar' }
  ],
  data: [
    [1, 'Alice'],
    [2, 'Bob'],
    [3, 'Carol']
  ],
  stats: { state: 'FINISHED' }
};

// --- Multi-page queries ---
//
// SQL markers below opt into the Trino paging protocol (POST → nextUri → GET …),
// so tests can exercise polling, running state and cancellation. Statements
// without a marker keep the single-response behaviour above.
//
//   FROM paged_table            QUEUED, then 3 pages of 10 rows via GET
//   FROM finished_paged_table   first response already FINISHED, 1 more page via GET
//   FAILS_SILENTLY              first response FAILED without an error object
//   FAILS_LATER                 one page of rows, then FAILED without an error object
//   HOLD:<id>                   RUNNING until released via POST /__mock/release/<id>
//   GATE:<id>                   submit response withheld until released (combinable)
//
// Gates and holds release themselves after GATE_TIMEOUT_MS so a broken test
// cannot wedge the mock. GET /__mock/log?marker=<text> lists submitted and
// cancelled statements containing <text>; tests use a random marker per test
// because all browser projects share this server.

const GATE_TIMEOUT_MS = 30_000;
const POLL_DELAY_MS = 100;

type Page = Record<string, unknown>;

interface MockQuery {
  sql: string;
  /** Responses for GET nextUri/1, /2, … */
  pages: Page[];
  /** Release id for HOLD queries, which stay RUNNING until released. */
  hold?: string;
  cancelled?: boolean;
}

const queries = new Map<string, MockQuery>();
const log: { event: 'submitted' | 'cancelled'; sql: string; queryId: string }[] = [];
const released = new Set<string>();
const waiters = new Map<string, (() => void)[]>();
let queryCounter = 0;

function waitForRelease(id: string): Promise<void> {
  if (released.has(id)) return Promise.resolve();
  return new Promise((resolve) => {
    waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
    setTimeout(() => release(id), GATE_TIMEOUT_MS).unref();
  });
}

function release(id: string): void {
  released.add(id);
  for (const resolve of waiters.get(id) ?? []) resolve();
  waiters.delete(id);
}

function nextUri(id: string, page: number): string {
  return `http://localhost:${MOCK_TRINO_PORT}/v1/statement/executing/${id}/${page}`;
}

function rows(from: number, count: number): unknown[][] {
  return Array.from({ length: count }, (_, i) => [from + i, `Row ${from + i}`]);
}

const COLUMNS = DEFAULT_RESPONSE.columns;

/** Build the first response for a multi-page statement, or null for the classic fixtures. */
function startPagedQuery(id: string, sql: string): Page | null {
  const hold = /HOLD:([\w-]+)/.exec(sql)?.[1];
  if (hold) {
    queries.set(id, { sql, pages: [], hold });
    setTimeout(() => release(hold), GATE_TIMEOUT_MS).unref();
    return { id, nextUri: nextUri(id, 1), stats: { state: 'QUEUED' } };
  }
  if (sql.includes('FROM paged_table')) {
    queries.set(id, {
      sql,
      pages: [
        {
          id,
          columns: COLUMNS,
          data: rows(1, 10),
          nextUri: nextUri(id, 2),
          stats: { state: 'RUNNING' }
        },
        { id, data: rows(11, 10), nextUri: nextUri(id, 3), stats: { state: 'RUNNING' } },
        { id, data: rows(21, 10), stats: { state: 'FINISHED' } }
      ]
    });
    return { id, nextUri: nextUri(id, 1), stats: { state: 'QUEUED' } };
  }
  if (sql.includes('FROM finished_paged_table')) {
    queries.set(id, { sql, pages: [{ id, data: rows(11, 10), stats: { state: 'FINISHED' } }] });
    return {
      id,
      columns: COLUMNS,
      data: rows(1, 10),
      nextUri: nextUri(id, 1),
      stats: { state: 'FINISHED' }
    };
  }
  if (sql.includes('FAILS_SILENTLY')) {
    return { id, stats: { state: 'FAILED' } };
  }
  if (sql.includes('FAILS_LATER')) {
    queries.set(id, {
      sql,
      pages: [
        {
          id,
          columns: COLUMNS,
          data: rows(1, 5),
          nextUri: nextUri(id, 2),
          stats: { state: 'RUNNING' }
        },
        { id, stats: { state: 'FAILED' } }
      ]
    });
    return { id, nextUri: nextUri(id, 1), stats: { state: 'QUEUED' } };
  }
  return null;
}

async function pollQuery(id: string, page: number): Promise<Page> {
  await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
  const query = queries.get(id);
  if (!query)
    return { id, error: { message: `Query ${id} not found` }, stats: { state: 'FAILED' } };
  if (query.cancelled) {
    // As real Trino: polling a cancelled query reports a user cancellation.
    return {
      id,
      error: { message: 'Query was canceled', errorName: 'USER_CANCELED' },
      stats: { state: 'FAILED' }
    };
  }
  if (query.hold) {
    if (!released.has(query.hold)) {
      return {
        id,
        nextUri: nextUri(id, page + 1),
        stats: { state: 'RUNNING', progressPercentage: 10 }
      };
    }
    return { ...DEFAULT_RESPONSE, id };
  }
  return query.pages[page - 1] ?? { id, stats: { state: 'FINISHED' } };
}

function cancelQuery(id: string): void {
  const query = queries.get(id);
  if (query) query.cancelled = true;
  log.push({ event: 'cancelled', sql: query?.sql ?? '', queryId: id });
}

function sendJson(res: http.ServerResponse, body: unknown): void {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

http
  .createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${MOCK_TRINO_PORT}`);

    // --- Test control endpoints ---
    if (url.pathname.startsWith('/__mock/release/') && req.method === 'POST') {
      release(decodeURIComponent(url.pathname.slice('/__mock/release/'.length)));
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === '/__mock/log') {
      const marker = url.searchParams.get('marker') ?? '';
      sendJson(
        res,
        log.filter((entry) => entry.sql.includes(marker))
      );
      return;
    }

    // --- Trino REST API ---
    const executing = /^\/v1\/statement\/executing\/([^/]+)\/(\d+)$/.exec(url.pathname);
    if (req.method === 'DELETE') {
      const cancelledId = executing?.[1] ?? /^\/v1\/query\/([^/]+)$/.exec(url.pathname)?.[1];
      if (cancelledId) cancelQuery(cancelledId);
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'GET' && executing) {
      pollQuery(executing[1], Number(executing[2])).then((page) => sendJson(res, page));
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/v1/statement') {
      // Readiness probe from Playwright's webServer.
      sendJson(res, { status: 'ok' });
      return;
    }

    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', async () => {
      // Logged on arrival, so tests can act while a gated submit is still pending.
      const id = `q-mock-${++queryCounter}`;
      queries.set(id, { sql: body, pages: [] });
      log.push({ event: 'submitted', sql: body, queryId: id });

      const gate = /GATE:([\w-]+)/.exec(body)?.[1];
      if (gate) await waitForRelease(gate);

      const paged = startPagedQuery(id, body);
      if (paged) {
        sendJson(res, paged);
        return;
      }
      // Unique id per submit so cancellations can be traced back to the statement.
      const match = routes.find(([key]) => body.includes(key));
      sendJson(res, { ...(match ? match[1] : DEFAULT_RESPONSE), id });
    });
  })
  .listen(MOCK_TRINO_PORT, 'localhost', () => console.log(`Mock Trino on :${MOCK_TRINO_PORT}`));
