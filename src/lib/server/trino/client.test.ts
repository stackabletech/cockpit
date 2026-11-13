import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mutable mock env — empty by default so importing client.ts does not build the
// env-configured singleton. Tests that need env vars populate it then re-import.
// vi.hoisted ensures the object exists before the hoisted vi.mock factory runs.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

import { TrinoClient, parseTrinoVersion, trinoMetadataQuery } from './client.js';
import { TrinoHttpError, TrinoQueryFailure } from './errors.js';

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

describe('parseTrinoVersion', () => {
  it.each([
    ['483', 483],
    ['476-stackable25.7.0', 476],
    ['476-stackable0.0.0-dev', 476],
    ['484-SNAPSHOT', 484],
    ['dev', null],
    [undefined, null]
  ])('parses %s as %s', (raw, expected) => {
    expect(parseTrinoVersion(raw)).toBe(expected);
  });
});

describe('TrinoClient.serverVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function stubInfo(version: string) {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ nodeVersion: { version } })
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('reads the version from /v1/info', async () => {
    const fetchMock = stubInfo('483');
    const client = new TrinoClient({ serverUrl: 'http://trino:8080/' });
    expect(await client.serverVersion()).toBe(483);
    expect(fetchMock).toHaveBeenCalledWith('http://trino:8080/v1/info', expect.anything());
  });

  it('requests the version once for concurrent and repeated calls', async () => {
    const fetchMock = stubInfo('480');
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    await Promise.all([client.serverVersion(), client.serverVersion()]);
    await client.serverVersion();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requests the version again once the cache has expired', async () => {
    vi.useFakeTimers();
    const fetchMock = stubInfo('482');
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    await client.serverVersion();
    fetchMock.mockImplementation(async () => ({
      ok: true,
      json: async () => ({ nodeVersion: { version: '483' } })
    }));
    vi.advanceTimersByTime(10 * 60_000 + 1);
    expect(await client.serverVersion()).toBe(483);
  });

  it('retries a failed detection after a minute', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }))
    );
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    expect(await client.serverVersion()).toBeNull();
    stubInfo('482');
    vi.advanceTimersByTime(60_000 + 1);
    expect(await client.serverVersion()).toBe(482);
  });

  it.each([
    ['an HTTP error', async () => ({ ok: false, status: 500 })],
    [
      'a network error',
      async () => {
        throw new Error('ECONNREFUSED');
      }
    ]
  ])('resolves to null on %s', async (_, impl) => {
    vi.stubGlobal('fetch', vi.fn(impl));
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    expect(await client.serverVersion()).toBeNull();
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
      expect.objectContaining({
        constructor: TrinoQueryFailure,
        trinoError: { message: 'Access Denied' }
      })
    );
  });

  it('throws an HTTP error without the response body when polling fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'q1', nextUri: 'http://n/1' }) })
      .mockResolvedValueOnce({ ok: false, status: 502, text: async () => '<html>proxy</html>' });
    vi.stubGlobal('fetch', fetchMock);
    const client = new TrinoClient({ serverUrl: 'http://trino:8080' });
    const result = trinoMetadataQuery(client, 'SELECT 1', { user: 'alice' });
    await expect(result).rejects.toBeInstanceOf(TrinoHttpError);
    await expect(result).rejects.toThrow('Trino poll failed (502)');
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

describe('insecure Trino TLS warning', () => {
  afterEach(() => {
    for (const key of Object.keys(mockEnv)) delete mockEnv[key];
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  async function warnings(nodeEnv: string, insecure: string) {
    vi.stubEnv('NODE_ENV', nodeEnv);
    mockEnv.STACKABLE_COCKPIT_TRINO_URL = 'https://trino:8443';
    mockEnv.STACKABLE_COCKPIT_TRINO_TLS_INSECURE = insecure;
    vi.resetModules();
    const { logger } = await import('$lib/server/logging');
    const log = logger.child({});
    vi.mocked(log.warn).mockClear();
    await import('./client.js');
    return vi.mocked(log.warn).mock.calls;
  }

  it('warns in production when certificate verification is disabled', async () => {
    expect(await warnings('production', 'true')).toEqual([
      [
        { trino_url: 'https://trino:8443' },
        expect.stringContaining('STACKABLE_COCKPIT_TLS_CA_CERTS')
      ]
    ]);
  });

  it.each([
    ['production', 'false'],
    ['development', 'true']
  ])('stays quiet in %s with insecure=%s', async (nodeEnv, insecure) => {
    expect(await warnings(nodeEnv, insecure)).toEqual([]);
  });
});
