import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/trino/client.js', () => ({
  resolveTrinoClient: vi.fn()
}));

vi.mock('$lib/server/trino/queries.js', () => ({
  startScript: vi.fn(),
  getQuerySnapshots: vi.fn(),
  cancelQuery: vi.fn(),
  removeTabQuery: vi.fn()
}));

import { POST, GET, DELETE } from './+server.js';
import { resolveTrinoClient } from '$lib/server/trino/client.js';
import {
  startScript,
  getQuerySnapshots,
  cancelQuery,
  removeTabQuery
} from '$lib/server/trino/queries.js';
import type { TrinoClient } from '$lib/server/trino/client.js';

const TAB_ID = '6f1c2a4e-8b3d-4c5e-9f7a-1b2c3d4e5f60';
const fakeClient = { fake: true } as unknown as TrinoClient;

function mockLocals(
  user: { id: string; username?: string } | null = { id: 'u1', username: 'alice' }
) {
  return {
    logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    user
  };
}

function postEvent(body: unknown, locals = mockLocals()) {
  const request = new Request('http://localhost/api/trino/query', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  return { request, locals } as unknown as Parameters<typeof POST>[0];
}

function urlEvent(params: string, locals = mockLocals()) {
  const url = new URL(`http://localhost/api/trino/query?${params}`);
  return { url, locals } as unknown as Parameters<typeof GET>[0];
}

describe('POST /api/trino/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTrinoClient).mockReturnValue(fakeClient);
    vi.mocked(startScript).mockResolvedValue();
  });

  it('returns 400 when no Trino connection is configured', async () => {
    vi.mocked(resolveTrinoClient).mockReturnValue(null);

    const res = await POST(postEvent({ statements: ['SELECT 1'], tabId: TAB_ID }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No Trino connection configured' });
    expect(startScript).not.toHaveBeenCalled();
  });

  it('returns 400 for a body that is not valid JSON', async () => {
    const res = await POST(postEvent('{not json'));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
  });

  it.each([
    ['no statements', { statements: [], tabId: TAB_ID }],
    ['an empty statement', { statements: [''], tabId: TAB_ID }],
    ['a non-UUID tabId', { statements: ['SELECT 1'], tabId: 'tab-1' }],
    ['a missing tabId', { statements: ['SELECT 1'] }]
  ])('returns 400 for %s', async (_label, body) => {
    const res = await POST(postEvent(body));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual(expect.any(String));
    expect(startScript).not.toHaveBeenCalled();
  });

  it('starts the script and returns 204', async () => {
    const res = await POST(
      postEvent({
        statements: ['SELECT 1', 'SELECT 2'],
        tabId: TAB_ID,
        catalog: 'tpch',
        schema: 'tiny'
      })
    );

    expect(res.status).toBe(204);
    expect(resolveTrinoClient).toHaveBeenCalledWith('u1');
    expect(startScript).toHaveBeenCalledWith(fakeClient, 'u1', TAB_ID, ['SELECT 1', 'SELECT 2'], {
      user: 'alice',
      catalog: 'tpch',
      schema: 'tiny'
    });
  });

  it('falls back to the anonymous user without a session user', async () => {
    const res = await POST(
      postEvent({ statements: ['SELECT 1'], tabId: TAB_ID }, mockLocals(null))
    );

    expect(res.status).toBe(204);
    expect(startScript).toHaveBeenCalledWith(fakeClient, 'anonymous', TAB_ID, ['SELECT 1'], {
      user: 'anonymous',
      catalog: undefined,
      schema: undefined
    });
  });

  it('logs but does not fail the request when the script orchestrator rejects', async () => {
    const err = new Error('boom');
    vi.mocked(startScript).mockRejectedValue(err);
    const locals = mockLocals();

    const res = await POST(postEvent({ statements: ['SELECT 1'], tabId: TAB_ID }, locals));

    expect(res.status).toBe(204);
    await vi.waitFor(() =>
      expect(locals.logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ err, tab_id: TAB_ID }),
        'script orchestrator crashed'
      )
    );
  });
});

describe('GET /api/trino/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getQuerySnapshots).mockReturnValue([]);
  });

  it.each([
    ['missing', ''],
    ['invalid', 'tabId=not-a-uuid']
  ])('returns 400 when tabId is %s', async (_label, params) => {
    const res = await GET(urlEvent(params));

    expect(res.status).toBe(400);
    expect(getQuerySnapshots).not.toHaveBeenCalled();
  });

  it('returns lightweight snapshots by default', async () => {
    const snapshot = { state: 'RUNNING', sql: 'SELECT 1' };
    vi.mocked(getQuerySnapshots).mockReturnValue([snapshot] as never);

    const res = await GET(urlEvent(`tabId=${TAB_ID}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([snapshot]);
    expect(getQuerySnapshots).toHaveBeenCalledWith('u1', TAB_ID, true);
  });

  it('returns full snapshots when lightweight=false', async () => {
    await GET(urlEvent(`tabId=${TAB_ID}&lightweight=false`));

    expect(getQuerySnapshots).toHaveBeenCalledWith('u1', TAB_ID, false);
  });
});

describe('DELETE /api/trino/query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cancelQuery).mockResolvedValue(true);
  });

  it('returns 400 when tabId is invalid', async () => {
    const res = await DELETE(urlEvent('tabId=nope'));

    expect(res.status).toBe(400);
    expect(cancelQuery).not.toHaveBeenCalled();
  });

  it('cancels the active query without removing tab state', async () => {
    const res = await DELETE(urlEvent(`tabId=${TAB_ID}`));

    expect(res.status).toBe(204);
    expect(cancelQuery).toHaveBeenCalledWith('u1', TAB_ID);
    expect(removeTabQuery).not.toHaveBeenCalled();
  });

  it('cancels and removes tab state when cleanup=true', async () => {
    const res = await DELETE(urlEvent(`tabId=${TAB_ID}&cleanup=true`));

    expect(res.status).toBe(204);
    expect(cancelQuery).toHaveBeenCalledWith('u1', TAB_ID);
    expect(removeTabQuery).toHaveBeenCalledWith('u1', TAB_ID);
  });
});
