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
  deleteConnection: (...args: unknown[]) => mockDeleteConnection(...args)
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
  return { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } };
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

  it('connect: returns message for non-s3 type', async () => {
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: { ...validFormData, type: 'hdfs' as const }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);

    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: mockLocals()
    } as unknown as Parameters<typeof actions.connect>[0]);
    expect(result).toHaveProperty('message', 'HDFS connections are not yet supported');
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
        locals: mockLocals()
      } as unknown as Parameters<typeof actions.connect>[0])
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
  });

  it('disconnect: redirects to /storage', async () => {
    await expect(
      actions.disconnect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: mockLocals()
      } as unknown as Parameters<typeof actions.disconnect>[0])
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
    expect(mockUpdateSession).toHaveBeenCalledWith(
      expect.objectContaining({ body: { activeStorageConnectionId: null } })
    );
  });
});
