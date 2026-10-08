import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/trino/client.js', () => ({
  resolveTrinoClient: vi.fn(),
  trinoMetadataQuery: vi.fn()
}));

import { GET } from './+server.js';
import { resolveTrinoClient, trinoMetadataQuery } from '$lib/server/trino/client.js';
import type { TrinoClient } from '$lib/server/trino/client.js';

const fakeClient = { fake: true } as unknown as TrinoClient;

function mockEvent(
  params: Record<string, string>,
  user: object | null = { id: 'u1', username: 'alice' }
) {
  const url = new URL('http://localhost/api/trino/catalog');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return {
    url,
    locals: { logger: { debug: vi.fn(), info: vi.fn() }, user }
  } as unknown as Parameters<typeof GET>[0];
}

/** SQL passed to Trino, with whitespace collapsed so assertions ignore formatting. */
function submittedSql(): string {
  return vi.mocked(trinoMetadataQuery).mock.calls[0][1].replace(/\s+/g, ' ').trim();
}

describe('GET /api/trino/catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTrinoClient).mockReturnValue(fakeClient);
    vi.mocked(trinoMetadataQuery).mockResolvedValue({ columns: [], rows: [] });
  });

  it('throws 400 when no Trino connection is configured', async () => {
    vi.mocked(resolveTrinoClient).mockReturnValue(null);

    await expect(GET(mockEvent({ level: 'catalogs' }))).rejects.toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(trinoMetadataQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['level is missing', {}],
    ['level is unknown', { level: 'functions' }],
    ['schemas lacks catalog', { level: 'schemas' }],
    ['tables lacks schema', { level: 'tables', catalog: 'tpch' }],
    ['columns lacks table', { level: 'columns', catalog: 'tpch', schema: 'tiny' }]
  ])('throws 400 when %s', async (_label, params) => {
    await expect(GET(mockEvent(params))).rejects.toThrow(expect.objectContaining({ status: 400 }));
    expect(trinoMetadataQuery).not.toHaveBeenCalled();
  });

  it('lists catalogs and returns the rows', async () => {
    vi.mocked(trinoMetadataQuery).mockResolvedValue({ columns: [], rows: [['tpch'], ['system']] });

    const res = await GET(mockEvent({ level: 'catalogs' }));

    expect(await res.json()).toEqual([['tpch'], ['system']]);
    expect(trinoMetadataQuery).toHaveBeenCalledWith(fakeClient, 'SHOW CATALOGS', { user: 'alice' });
  });

  it('falls back to the anonymous user without a session user', async () => {
    await GET(mockEvent({ level: 'catalogs' }, null));

    expect(resolveTrinoClient).toHaveBeenCalledWith('anonymous');
    expect(trinoMetadataQuery).toHaveBeenCalledWith(fakeClient, 'SHOW CATALOGS', {
      user: 'anonymous'
    });
  });

  it('quotes the catalog identifier when listing schemas', async () => {
    await GET(mockEvent({ level: 'schemas', catalog: 'my"cat' }));

    expect(submittedSql()).toBe('SHOW SCHEMAS FROM "my""cat"');
  });

  it('quotes identifiers and escapes string literals when listing tables', async () => {
    await GET(mockEvent({ level: 'tables', catalog: 'it\'s"cat', schema: "o'schema" }));

    const sql = submittedSql();
    expect(sql).toContain(`FROM "it's""cat".information_schema.tables t`);
    expect(sql).toContain(`mv.catalog_name = 'it''s"cat'`);
    expect(sql).toContain(`WHERE t.table_schema = 'o''schema'`);
  });

  it('quotes every name part when describing columns', async () => {
    await GET(mockEvent({ level: 'columns', catalog: 'tpch', schema: 'my-schema', table: 'a"b' }));

    expect(submittedSql()).toBe('DESCRIBE "tpch"."my-schema"."a""b"');
  });

  it('throws 502 with the Trino error message when the query fails', async () => {
    vi.mocked(trinoMetadataQuery).mockRejectedValue(new Error('Catalog does not exist'));

    await expect(GET(mockEvent({ level: 'schemas', catalog: 'nope' }))).rejects.toThrow(
      expect.objectContaining({ status: 502, body: { message: 'Catalog does not exist' } })
    );
  });
});
