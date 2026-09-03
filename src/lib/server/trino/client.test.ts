import { describe, it, expect, vi, beforeEach } from 'vitest';

// Empty env so importing client.ts does not build the env-configured singleton.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }
}));

import { TrinoClient } from './client.js';

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
