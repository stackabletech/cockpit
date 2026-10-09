import { describe, it, expect, vi, beforeEach } from 'vitest';

const { flags } = vi.hoisted(() => ({ flags: { completionEnabled: true } }));

vi.mock('$lib/server/feature-flags.js', () => ({
  get completionEnabled() {
    return flags.completionEnabled;
  }
}));

vi.mock('$lib/server/trino/client.js', () => ({
  resolveTrinoClient: vi.fn(),
  trinoMetadataQuery: vi.fn()
}));

import { GET } from './+server.js';
import { resolveTrinoClient, trinoMetadataQuery } from '$lib/server/trino/client.js';
import type { TrinoClient } from '$lib/server/trino/client.js';

const fakeClient = { fake: true } as unknown as TrinoClient;

function mockEvent(params: Record<string, string>) {
  const url = new URL('http://localhost/api/trino/completion/metadata');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    url,
    locals: { logger: { debug: vi.fn(), info: vi.fn() }, user: { id: 'u1', username: 'alice' } }
  } as unknown as Parameters<typeof GET>[0];
}

function submitted(): { sql: string; opts: unknown } {
  const [, sql, opts] = vi.mocked(trinoMetadataQuery).mock.calls[0];
  return { sql: sql.replace(/\s+/g, ' ').trim(), opts };
}

describe('GET /api/trino/completion/metadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    flags.completionEnabled = true;
    vi.mocked(resolveTrinoClient).mockReturnValue(fakeClient);
    vi.mocked(trinoMetadataQuery).mockResolvedValue({ columns: [], rows: [] });
  });

  it('throws 404 when code completion is disabled', async () => {
    flags.completionEnabled = false;

    await expect(GET(mockEvent({ level: 'catalogs' }))).rejects.toThrow(
      expect.objectContaining({ status: 404 })
    );
    expect(resolveTrinoClient).not.toHaveBeenCalled();
  });

  it('throws 400 when no Trino connection is configured', async () => {
    vi.mocked(resolveTrinoClient).mockReturnValue(null);

    await expect(GET(mockEvent({ level: 'catalogs' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it.each([
    ['level is missing', {}],
    ['level is unknown', { level: 'views' }],
    ['catalog is empty', { level: 'schemas', catalog: '' }],
    ['schema is too long', { level: 'tables', schema: 'x'.repeat(1025) }],
    ['columns lacks table', { level: 'columns', catalog: 'tpch', schema: 'tiny' }]
  ])('throws 400 when %s', async (_label, params) => {
    await expect(GET(mockEvent(params))).rejects.toThrow(expect.objectContaining({ status: 400 }));
    expect(trinoMetadataQuery).not.toHaveBeenCalled();
  });

  it('lists catalogs as a flat name array', async () => {
    vi.mocked(trinoMetadataQuery).mockResolvedValue({ columns: [], rows: [['tpch'], ['system']] });

    const res = await GET(mockEvent({ level: 'catalogs' }));

    expect(await res.json()).toEqual(['tpch', 'system']);
    expect(submitted()).toEqual({ sql: 'SHOW CATALOGS', opts: { user: 'alice' } });
  });

  it('lists schemas using the catalog as session context', async () => {
    await GET(mockEvent({ level: 'schemas', catalog: 'tpch' }));

    expect(submitted()).toEqual({ sql: 'SHOW SCHEMAS', opts: { user: 'alice', catalog: 'tpch' } });
  });

  it('lists tables without a schema filter when no schema is given', async () => {
    await GET(mockEvent({ level: 'tables', catalog: 'tpch' }));

    const { sql, opts } = submitted();
    expect(sql).not.toContain('WHERE');
    expect(opts).toEqual({ user: 'alice', catalog: 'tpch' });
  });

  it('filters tables by an escaped schema literal', async () => {
    await GET(mockEvent({ level: 'tables', catalog: 'tpch', schema: "o'schema" }));

    expect(submitted().sql).toContain(`WHERE t.table_schema = 'o''schema'`);
  });

  it('maps table types to completion kinds', async () => {
    vi.mocked(trinoMetadataQuery).mockResolvedValue({
      columns: [],
      rows: [
        ['orders', 'BASE TABLE'],
        ['v_orders', 'VIEW'],
        ['mv_orders', 'MATERIALIZED VIEW'],
        ['lower_view', 'view'],
        ['untyped', null]
      ]
    });

    const res = await GET(mockEvent({ level: 'tables', catalog: 'tpch', schema: 'tiny' }));

    expect(await res.json()).toEqual([
      { name: 'orders', kind: 'table' },
      { name: 'v_orders', kind: 'view' },
      { name: 'mv_orders', kind: 'materialized_view' },
      { name: 'lower_view', kind: 'view' },
      { name: 'untyped', kind: 'table' }
    ]);
  });

  it('describes columns with a quoted table name and catalog/schema context', async () => {
    vi.mocked(trinoMetadataQuery).mockResolvedValue({
      columns: [],
      rows: [
        ['orderkey', 'bigint', '', ''],
        ['custkey', 'bigint', '', '']
      ]
    });

    const res = await GET(
      mockEvent({ level: 'columns', catalog: 'tpch', schema: 'tiny', table: 'a"b' })
    );

    expect(await res.json()).toEqual(['orderkey', 'custkey']);
    expect(submitted()).toEqual({
      sql: 'DESCRIBE "a""b"',
      opts: { user: 'alice', catalog: 'tpch', schema: 'tiny' }
    });
  });

  it('dedupes and sorts function overloads', async () => {
    vi.mocked(trinoMetadataQuery).mockResolvedValue({
      columns: [],
      rows: [['substr'], ['abs'], ['substr'], ['abs'], ['concat']]
    });

    const res = await GET(mockEvent({ level: 'functions' }));

    expect(await res.json()).toEqual(['abs', 'concat', 'substr']);
    expect(submitted()).toEqual({ sql: 'SHOW FUNCTIONS', opts: { user: 'alice' } });
  });

  it('throws 502 with the Trino error message when the query fails', async () => {
    vi.mocked(trinoMetadataQuery).mockRejectedValue(new Error('Access Denied'));

    await expect(GET(mockEvent({ level: 'catalogs' }))).rejects.toThrow(
      expect.objectContaining({ status: 502, body: { message: 'Access Denied' } })
    );
  });
});
