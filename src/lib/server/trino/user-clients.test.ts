import { describe, it, expect, vi, beforeEach } from 'vitest';

const { TrinoClientMock } = vi.hoisted(() => ({
  TrinoClientMock: vi.fn(function (this: Record<string, unknown>, options: unknown) {
    this.options = options;
  })
}));

vi.mock('$lib/server/logging', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }
}));
vi.mock('./client.js', () => ({
  TrinoClient: TrinoClientMock,
  buildBasicAuthHeader: (user: string, pass: string) => `Basic ${user}:${pass}`,
  trinoUserImpersonation: true
}));

type UserClients = typeof import('./user-clients.js');
let uc: UserClients;

const BASE = { url: 'http://trino:8080', authType: 'none', username: '', password: '' } as const;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  uc = await import('./user-clients.js');
});

describe('buildUserTrinoClient', () => {
  it('builds an unauthenticated client for authType none', () => {
    uc.buildUserTrinoClient({ ...BASE, username: 'alice', password: 'secret' });

    expect(TrinoClientMock).toHaveBeenCalledWith({
      serverUrl: 'http://trino:8080',
      authorization: undefined,
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
});
