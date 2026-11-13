import { describe, it, expect, vi, beforeEach } from 'vitest';

const { TrinoClientMock, AgentMock, trinoConfigMock, logMock } = vi.hoisted(() => ({
  TrinoClientMock: vi.fn(function (this: Record<string, unknown>, options: unknown) {
    this.options = options;
  }),
  AgentMock: vi.fn(function (this: Record<string, unknown>, options: unknown) {
    this.options = options;
  }),
  trinoConfigMock: { userConnectionAllowInsecureTls: false },
  logMock: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() }
}));

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => logMock }
}));
vi.mock('./client.js', () => ({
  TrinoClient: TrinoClientMock,
  buildBasicAuthHeader: (user: string, pass: string) => `Basic ${user}:${pass}`,
  trinoUserImpersonation: true
}));
vi.mock('./config.js', () => ({ trinoConfig: trinoConfigMock }));
vi.mock('undici', () => ({ Agent: AgentMock }));

type UserClients = typeof import('./user-clients.js');
let uc: UserClients;

const BASE = {
  url: 'http://trino:8080',
  authType: 'none',
  username: '',
  password: '',
  tlsInsecure: false
} as const;
const BASIC = { ...BASE, authType: 'basic', username: 'alice', password: 'secret' } as const;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  trinoConfigMock.userConnectionAllowInsecureTls = false;
  uc = await import('./user-clients.js');
});

describe('buildUserTrinoClient', () => {
  it('builds an unauthenticated client for authType none', () => {
    uc.buildUserTrinoClient({ ...BASE, username: 'alice', password: 'secret' });

    expect(TrinoClientMock).toHaveBeenCalledWith({
      serverUrl: 'http://trino:8080',
      authorization: undefined,
      dispatcher: undefined,
      impersonate: true
    });
  });

  it('sends Basic auth when both credentials are set', () => {
    uc.buildUserTrinoClient({ ...BASE, authType: 'basic', username: 'alice', password: 'secret' });

    expect(TrinoClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ authorization: 'Basic alice:secret' })
    );
  });

  it.each([
    ['username', { username: '', password: 'secret' }],
    ['password', { username: 'alice', password: '' }]
  ])('omits Basic auth when the %s is missing', (_label, creds) => {
    uc.buildUserTrinoClient({ ...BASE, authType: 'basic', ...creds });

    expect(TrinoClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ authorization: undefined })
    );
  });

  it('rejects skipping TLS verification unless allowed', () => {
    expect(() => uc.buildUserTrinoClient({ ...BASE, tlsInsecure: true })).toThrow(/not allowed/);
    expect(TrinoClientMock).not.toHaveBeenCalled();
  });

  it('skips TLS verification when allowed and requested', () => {
    trinoConfigMock.userConnectionAllowInsecureTls = true;
    uc.buildUserTrinoClient({ ...BASE, tlsInsecure: true });

    uc.buildUserTrinoClient({ ...BASIC, tlsInsecure: true });

    expect(AgentMock).toHaveBeenCalledTimes(1);
    expect(AgentMock).toHaveBeenCalledWith({ connect: { rejectUnauthorized: false } });
    const dispatchers = TrinoClientMock.mock.calls.map(
      ([options]) => (options as { dispatcher?: unknown }).dispatcher
    );
    expect(dispatchers).toEqual([AgentMock.mock.instances[0], AgentMock.mock.instances[0]]);
  });

  it('does not store the client', () => {
    uc.buildUserTrinoClient(BASE);

    expect(uc.getUserTrinoClient('u1')).toBeNull();
  });
});

describe('per-user connections', () => {
  it('returns null for a user without a connection', () => {
    expect(uc.getUserTrinoClient('u1')).toBeNull();
    expect(uc.getUserTrinoUrl('u1')).toBeNull();
  });

  it('stores the client and URL per user', () => {
    uc.createUserTrinoClient('u1', BASE);

    expect(uc.getUserTrinoClient('u1')).toBe(TrinoClientMock.mock.instances[0]);
    expect(uc.getUserTrinoUrl('u1')).toBe('http://trino:8080');
    expect(uc.getUserTrinoClient('u2')).toBeNull();
  });

  it('replaces an existing connection', () => {
    uc.createUserTrinoClient('u1', BASE);
    uc.createUserTrinoClient('u1', { ...BASE, url: 'http://other:8443' });

    expect(uc.getUserTrinoClient('u1')).toBe(TrinoClientMock.mock.instances[1]);
    expect(uc.getUserTrinoUrl('u1')).toBe('http://other:8443');
  });

  it('logs a warning when the connection skips TLS verification', () => {
    trinoConfigMock.userConnectionAllowInsecureTls = true;
    uc.createUserTrinoClient('u1', BASE);
    expect(logMock.warn).not.toHaveBeenCalled();

    uc.createUserTrinoClient('u1', { ...BASE, tlsInsecure: true });
    expect(logMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'u1', tls_insecure: true }),
      expect.stringContaining('without TLS certificate verification')
    );
  });
});
