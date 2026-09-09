import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable mock env — empty by default so importing client.ts does not build the
// env-configured singleton. Tests that need env vars populate it then re-import.
// vi.hoisted ensures the object exists before the hoisted vi.mock factory runs.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }
}));

import { TrinoClient, trinoMetadataQuery } from './client.js';

describe('TrinoClient X-Trino-User header', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ id: 'q1' }) }));
    vi.stubGlobal('fetch', fetchMock);
  });

  function submittedHeaders(): Record<string, string> {
    return fetchMock.mock.calls[0][1].headers as Record<string, string>;
  }

  it('forwards X-Trino-User when impersonation is enabled (default)', async () => {
    const client = new TrinoClient({ serverUrl: 'http://trino:8080', authorization: 'Basic abc' });
    await client.submit('SELECT 1', { user: 'alice' });
    expect(submittedHeaders()['X-Trino-User']).toBe('alice');
  });

  it('omits X-Trino-User when impersonation is disabled and credentials are present', async () => {
    const client = new TrinoClient({
      serverUrl: 'http://trino:8080',
      authorization: 'Basic abc',
      impersonate: false
    });
    await client.submit('SELECT 1', { user: 'alice' });
    expect(submittedHeaders()).not.toHaveProperty('X-Trino-User');
  });

  it('still sends X-Trino-User when impersonation is disabled but no credentials are set', async () => {
    const client = new TrinoClient({ serverUrl: 'http://trino:8080', impersonate: false });
    await client.submit('SELECT 1', { user: 'anonymous' });
    expect(submittedHeaders()['X-Trino-User']).toBe('anonymous');
  });
});

describe('TrinoClient.cancelViaUri', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends a DELETE to the given nextUri', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    const uri = 'http://trino:8080/v1/statement/executing/q1/slug/1';
    await client.cancelViaUri(uri);
    expect(fetchMock).toHaveBeenCalledWith(uri, expect.objectContaining({ method: 'DELETE' }));
  });

  it('forwards X-Trino-User when impersonating', async () => {
    const fetchMock: ReturnType<typeof vi.fn> = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => ''
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080', authorization: 'Basic abc' });
    await client.cancelViaUri('http://trino:8080/next', 'alice');
    expect(fetchMock.mock.calls[0][1].headers['X-Trino-User']).toBe('alice');
  });

  it('omits X-Trino-User when impersonation is disabled', async () => {
    const fetchMock: ReturnType<typeof vi.fn> = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => ''
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({
      serverUrl: 'http://trino:8080',
      authorization: 'Basic abc',
      impersonate: false
    });
    await client.cancelViaUri('http://trino:8080/next', 'alice');
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('X-Trino-User');
  });

  it('does not throw when the URI is already gone (404/410)', async () => {
    for (const status of [404, 410]) {
      const fetchMock = vi.fn(async () => ({ ok: false, status, text: async () => '' }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
      await expect(client.cancelViaUri('http://trino:8080/next')).resolves.toBeUndefined();
    }
  });

  it('throws on other non-ok responses', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    await expect(client.cancelViaUri('http://trino:8080/next')).rejects.toThrow(/500/);
  });
});

describe('TrinoClient AbortSignal forwarding', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('forwards the signal to fetch on submit', async () => {
    const fetchMock: ReturnType<typeof vi.fn> = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'q1' })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    const ac = new AbortController();
    await client.submit('SELECT 1', { user: 'alice', signal: ac.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(ac.signal);
  });

  it('forwards the signal to fetch on poll', async () => {
    const fetchMock: ReturnType<typeof vi.fn> = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'q1' })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    const ac = new AbortController();
    await client.poll('http://trino:8080/next', { signal: ac.signal });
    expect(fetchMock.mock.calls[0][1].signal).toBe(ac.signal);
  });
});

describe('trinoMetadataQuery (connection test path)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves rows for a successful single-page query', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'q1', columns: [{ name: '_col0', type: 'integer' }], data: [[1]] })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    const { rows } = await trinoMetadataQuery(client, 'SELECT 1', { user: 'alice' });
    expect(rows).toEqual([[1]]);
  });

  it('throws when the query returns an error (bad connection/credentials)', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ id: 'q1', error: { message: 'Access Denied' } })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    await expect(trinoMetadataQuery(client, 'SELECT 1', { user: 'alice' })).rejects.toThrow(
      'Access Denied'
    );
  });
});

describe('resolveTrinoPublicUrl', () => {
  afterEach(() => {
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
    vi.resetModules();
  });

  it('returns the trimmed public URL when configured', async () => {
    mockEnv.STACKABLE_COCKPIT_TRINO_URL = 'http://internal:8080';
    mockEnv.STACKABLE_COCKPIT_TRINO_PUBLIC_URL = 'https://public.example.com/';
    vi.resetModules();
    const mod = await import('./client.js');
    expect(mod.resolveTrinoPublicUrl('user1')).toBe('https://public.example.com');
  });

  it('falls back to the server URL when no public URL is set', async () => {
    mockEnv.STACKABLE_COCKPIT_TRINO_URL = 'http://internal:8080';
    vi.resetModules();
    const mod = await import('./client.js');
    expect(mod.resolveTrinoPublicUrl('user1')).toBe('http://internal:8080');
  });
});
