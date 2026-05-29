import * as http from 'node:http';

const PORT = 8080;

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

http
  .createServer((req, res) => {
    if (req.method === 'DELETE') {
      res.writeHead(204).end();
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => (body += c));
    req.on('end', () => {
      const match = routes.find(([key]) => body.includes(key));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(match ? match[1] : DEFAULT_RESPONSE));
    });
  })
  .listen(PORT, 'localhost', () => console.log(`Mock Trino on :${PORT}`));
