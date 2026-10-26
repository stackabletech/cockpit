import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerify, MockNotTrinoServerError } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  MockNotTrinoServerError: class extends Error {}
}));
vi.mock('$lib/server/trino/client.js', () => ({
  trinoConfigured: false,
  verifyTrinoServer: mockVerify,
  NotTrinoServerError: MockNotTrinoServerError,
  CONN_TEST_TIMEOUT_MS: 10_000
}));

const mockCreateClient = vi.fn();
vi.mock('$lib/server/trino/user-clients.js', () => ({
  buildUserTrinoClient: vi.fn(() => ({})),
  createUserTrinoClient: (...args: unknown[]) => mockCreateClient(...args),
  getUserTrinoClient: vi.fn(() => null)
}));

vi.mock('$lib/server/trino/queries.js', () => ({
  getAllQuerySummaries: vi.fn(() => ({})),
  resetTabQueries: vi.fn()
}));

vi.mock('$lib/server/feature-flags.js', () => ({ completionEnabled: false }));

vi.mock('sveltekit-superforms', () => ({
  superValidate: vi.fn(),
  message: vi.fn((form, msg, opts) => ({ form, message: msg, status: opts?.status }))
}));

vi.mock('sveltekit-superforms/adapters', () => ({
  zod4: vi.fn((schema) => schema)
}));

import { actions } from './+page.server.js';
import { superValidate } from 'sveltekit-superforms';
import * as m from '$lib/paraglide/messages.js';

function callSave() {
  const locals = {
    logger: { debug: vi.fn(), info: vi.fn() },
    user: { id: 'test-user', username: 'alice' }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return actions.save({ request: new Request('http://localhost'), locals } as any) as Promise<
    Record<string, unknown>
  >;
}

describe('trino page save action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: {
        connectionUrl: 'http://not-trino:8080',
        authType: 'none',
        authUsername: '',
        authPassword: ''
      }
    } as never);
  });

  it('rejects a target that is not Trino without storing the client', async () => {
    mockVerify.mockRejectedValue(new MockNotTrinoServerError('nope'));
    const result = await callSave();
    expect(result.message).toEqual({ type: 'error', message: m.trino_connection_not_trino() });
    expect(result.status).toBe(400);
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('reports other failures as a generic connection failure', async () => {
    mockVerify.mockRejectedValue(new Error('Access Denied'));
    const result = await callSave();
    expect(result.message).toEqual({ type: 'error', message: m.trino_connection_test_failed() });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('stores the client once the target is verified', async () => {
    mockVerify.mockResolvedValue(undefined);
    const result = await callSave();
    expect(result.message).toEqual({ type: 'success' });
    expect(mockCreateClient).toHaveBeenCalledOnce();
  });
});
