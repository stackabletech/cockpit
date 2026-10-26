import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnectionProvider = { listContainers: vi.fn() };
vi.mock('$lib/server/storage/utils.js', () => ({
  getConnectionProvider: () => mockConnectionProvider
}));

vi.mock('$lib/storage/schemas.js', () => ({
  StorageConnectionSchema: {},
  ConnectionIdSchema: {}
}));

const { mockUpdateSession } = vi.hoisted(() => ({
  mockUpdateSession: vi.fn().mockResolvedValue({})
}));
vi.mock('$lib/server/auth.js', () => ({
  auth: { api: { updateSession: mockUpdateSession } }
}));

const mockSaveConnection = vi.fn().mockResolvedValue('new-conn-id');
const mockGetConnectionForUser = vi.fn();
const mockDeleteConnection = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/storage/connections-db.js', () => ({
  saveConnection: (...args: unknown[]) => mockSaveConnection(...args),
  getConnectionForUser: (...args: unknown[]) => mockGetConnectionForUser(...args),
  deleteConnection: (...args: unknown[]) => mockDeleteConnection(...args),
  listConnectionItems: vi.fn().mockResolvedValue([])
}));

const mockHdfsEnabled = vi.fn(() => false);
const mockKerberosAvailable = vi.fn(() => false);
vi.mock('$lib/server/feature-flags.js', () => ({
  get storageHdfsEnabled() {
    return mockHdfsEnabled();
  },
  get hdfsKerberosAvailable() {
    return mockKerberosAvailable();
  }
}));

vi.mock('sveltekit-superforms', () => ({
  superValidate: vi.fn(),
  message: vi.fn((form, msg, opts) => ({ form, message: msg, status: opts?.status }))
}));

vi.mock('sveltekit-superforms/adapters', () => ({
  zod4: vi.fn((schema) => schema)
}));

const mockDbInsert = vi.fn();
const mockDbSelect = vi.fn().mockResolvedValue([]);
vi.mock('$lib/server/db.js', () => ({
  db: {
    insert: () => ({ values: () => ({ returning: mockDbInsert }) }),
    select: () => ({
      from: () => ({ where: () => ({ orderBy: mockDbSelect, limit: mockDbSelect }) })
    })
  }
}));

vi.mock('$lib/server/storage/encryption.js', () => ({
  encrypt: vi.fn(() => 'encrypted-payload'),
  fingerprint: vi.fn(() => 'fp-hash')
}));

vi.mock('$lib/server/storage/encryption-key.js', () => ({
  storageEncryptionKey: () => Buffer.alloc(32)
}));

vi.mock('$lib/server/schema.js', () => ({
  userStorageConnections: {}
}));

import { load, actions } from './+page.server.js';
import { superValidate } from 'sveltekit-superforms';

function mockLocals() {
  return {
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    user: { id: 'test-user' },
    session: { activeStorageConnectionId: null }
  };
}

function mockCookies() {
  return { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
}

const validFormData = {
  type: 's3' as const,
  endpoint: 'http://s3',
  pathStyle: true,
  region: 'us-east-1',
  accessKeyId: 'ak',
  secretAccessKey: 'sk'
};

describe('storage page load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns connectionForm', async () => {
    vi.mocked(superValidate).mockResolvedValue({ data: {} } as unknown as Awaited<
      ReturnType<typeof superValidate>
    >);

    const result = (await load({
      locals: mockLocals()
    } as unknown as Parameters<typeof load>[0])) as { connectionForm: unknown };
    expect(result.connectionForm).toBeDefined();
  });
});

describe('storage page actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('connect: returns fail(400) on invalid form', async () => {
    vi.mocked(superValidate).mockResolvedValue({ valid: false, errors: {} } as unknown as Awaited<
      ReturnType<typeof superValidate>
    >);

    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: mockLocals()
    } as unknown as Parameters<typeof actions.connect>[0]);
    expect(result?.status).toBe(400);
  });

  it('connect: rejects hdfs when the HDFS flag is off', async () => {
    mockHdfsEnabled.mockReturnValue(false);
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: { ...validFormData, type: 'hdfs' as const }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);

    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: mockLocals()
    } as unknown as Parameters<typeof actions.connect>[0]);
    expect(result).toHaveProperty('message', 'HDFS connections are not enabled on this server.');
    expect(mockSaveConnection).not.toHaveBeenCalled();
  });

  it('connect: hdfs uses the SSO username and ignores the form user', async () => {
    mockHdfsEnabled.mockReturnValue(true);
    mockConnectionProvider.listContainers.mockResolvedValue(['/']);
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: { type: 'hdfs', host: 'namenode', port: 9870, devUser: 'hdfs' }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);

    await expect(
      actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: { ...mockLocals(), user: { id: 'test-user', username: 'alice' } },
        cookies: mockCookies()
      } as unknown as Parameters<typeof actions.connect>[0])
    ).rejects.toMatchObject({ status: 303 });
    expect(mockSaveConnection).toHaveBeenCalledWith(
      'test-user',
      {
        type: 'hdfs',
        host: 'namenode',
        port: 9870,
        tls: undefined,
        nameNodes: ['namenode'],
        user: 'alice'
      },
      undefined
    );
  });

  it('connect: hdfs stores every NameNode of an HA pair', async () => {
    mockHdfsEnabled.mockReturnValue(true);
    mockConnectionProvider.listContainers.mockResolvedValue(['/']);
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: { type: 'hdfs', host: 'http://nn-0.svc:9870, nn-1.svc:9870 ' }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);

    await expect(
      actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: { ...mockLocals(), user: { id: 'test-user', username: 'alice' } },
        cookies: mockCookies()
      } as unknown as Parameters<typeof actions.connect>[0])
    ).rejects.toMatchObject({ status: 303 });
    expect(mockSaveConnection).toHaveBeenLastCalledWith(
      'test-user',
      expect.objectContaining({ host: 'nn-0.svc', nameNodes: ['nn-0.svc:9870', 'nn-1.svc:9870'] }),
      undefined
    );
  });

  it('connect: hdfs Kerberos needs a server keytab and a valid service principal', async () => {
    mockHdfsEnabled.mockReturnValue(true);
    mockConnectionProvider.listContainers.mockResolvedValue(['/']);
    const locals = { ...mockLocals(), user: { id: 'test-user', username: 'alice' } };
    const connect = (data: Record<string, unknown>) => {
      vi.mocked(superValidate).mockResolvedValue({ valid: true, data } as unknown as Awaited<
        ReturnType<typeof superValidate>
      >);
      return actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals,
        cookies: mockCookies()
      } as unknown as Parameters<typeof actions.connect>[0]);
    };

    mockKerberosAvailable.mockReturnValue(false);
    await expect(connect({ type: 'hdfs', host: 'nn-0', auth: 'kerberos' })).resolves.toHaveProperty(
      'message',
      'Kerberos is not configured on this server.'
    );

    mockKerberosAvailable.mockReturnValue(true);
    await expect(
      connect({ type: 'hdfs', host: 'nn-0', auth: 'kerberos', servicePrincipal: 'not a principal' })
    ).resolves.toHaveProperty(
      'message',
      'Enter the service principal as service/host, for example HTTP/hdfs.default.svc.cluster.local.'
    );

    await expect(
      connect({
        type: 'hdfs',
        host: 'nn-0:9871, nn-1:9871',
        auth: 'kerberos',
        servicePrincipal: 'HTTP/hdfs.default.svc.cluster.local@CLUSTER.LOCAL',
        tls: { verification: 'Full' }
      })
    ).rejects.toMatchObject({ status: 303 });
    expect(mockSaveConnection).toHaveBeenLastCalledWith(
      'test-user',
      expect.objectContaining({
        auth: 'kerberos',
        servicePrincipal: 'HTTP/hdfs.default.svc.cluster.local@CLUSTER.LOCAL',
        user: 'alice'
      }),
      undefined
    );
    mockKerberosAvailable.mockReturnValue(false);
  });

  it('connect: hdfs rejects malformed NameNode lists', async () => {
    mockHdfsEnabled.mockReturnValue(true);
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: { type: 'hdfs', host: 'nn-0, bad host' }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: { ...mockLocals(), user: { id: 'test-user', username: 'alice' } }
    } as unknown as Parameters<typeof actions.connect>[0]);
    expect(result).toHaveProperty(
      'message',
      'Enter NameNode hosts as host or host:port, separated by commas.'
    );
  });

  it('connect: hdfs without OIDC requires and stores the dev-mode user', async () => {
    mockHdfsEnabled.mockReturnValue(true);
    mockConnectionProvider.listContainers.mockResolvedValue(['/']);
    const noOidcLocals = { ...mockLocals(), user: null, session: null };

    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: { type: 'hdfs', host: 'namenode', devUser: '' }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    const missing = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: noOidcLocals
    } as unknown as Parameters<typeof actions.connect>[0]);
    expect(missing).toHaveProperty('message', 'An HDFS user is required.');

    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: { type: 'hdfs', host: 'namenode', devUser: 'dev' }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    await expect(
      actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: noOidcLocals,
        cookies: mockCookies()
      } as unknown as Parameters<typeof actions.connect>[0])
    ).rejects.toMatchObject({ status: 303 });
    expect(mockSaveConnection).toHaveBeenLastCalledWith(
      'anonymous',
      expect.objectContaining({ type: 'hdfs', user: 'dev' }),
      'dev'
    );
  });

  it('connect: returns error message on connection test failure', async () => {
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: {
        type: 's3',
        host: 's3.example.com',
        accessStyle: 'Path',
        region: { name: 'us-east-1' },
        credentials: { accessKey: 'ak', secretKey: 'sk' }
      }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    mockConnectionProvider.listContainers.mockRejectedValue(new Error('connection refused'));

    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: mockLocals()
    } as unknown as Parameters<typeof actions.connect>[0]);
    expect(result).toHaveProperty(
      'message',
      'Could not connect — check the endpoint and credentials.'
    );
  });

  it('connect: redirects on success', async () => {
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: {
        type: 's3',
        host: 's3.example.com',
        accessStyle: 'Path',
        region: { name: 'us-east-1' },
        credentials: { accessKey: 'ak', secretKey: 'sk' }
      }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    mockConnectionProvider.listContainers.mockResolvedValue(['b1']);
    mockSaveConnection.mockResolvedValue('new-conn-id');

    await expect(
      actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: mockLocals(),
        cookies: mockCookies()
      } as unknown as Parameters<typeof actions.connect>[0])
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
  });

  it('disconnect: redirects to /storage', async () => {
    await expect(
      actions.disconnect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: mockLocals(),
        cookies: mockCookies()
      } as unknown as Parameters<typeof actions.disconnect>[0])
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({ body: { activeStorageConnectionId: null } })
    );
  });

  it('connect: sets a cookie instead of the session when there is no session (no-OIDC mode)', async () => {
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: {
        type: 's3',
        host: 's3.example.com',
        accessStyle: 'Path',
        region: { name: 'us-east-1' },
        credentials: { accessKey: 'ak', secretKey: 'sk' }
      }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    mockConnectionProvider.listContainers.mockResolvedValue(['b1']);
    mockSaveConnection.mockResolvedValue('new-conn-id');
    const cookies = mockCookies();

    await expect(
      actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: { ...mockLocals(), session: null },
        cookies
      } as unknown as Parameters<typeof actions.connect>[0])
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(cookies.set).toHaveBeenCalledWith(
      'storage-active-connection-id',
      'new-conn-id',
      expect.objectContaining({ path: '/' })
    );
  });

  it('disconnect: clears the cookie instead of the session when there is no session (no-OIDC mode)', async () => {
    const cookies = mockCookies();

    await expect(
      actions.disconnect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: { ...mockLocals(), session: null },
        cookies
      } as unknown as Parameters<typeof actions.disconnect>[0])
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(cookies.delete).toHaveBeenCalledWith(
      'storage-active-connection-id',
      expect.objectContaining({ path: '/' })
    );
  });
});
