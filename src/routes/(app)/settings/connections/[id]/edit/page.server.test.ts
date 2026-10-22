import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnectionProvider = { listContainers: vi.fn() };
const mockGetConnectionProvider = vi.fn((config: unknown) => {
  void config;
  return mockConnectionProvider;
});
vi.mock('$lib/server/storage/utils.js', () => ({
  getConnectionProvider: (config: unknown) => mockGetConnectionProvider(config)
}));

vi.mock('$lib/storage/schemas.js', () => ({
  EditStorageConnectionSchema: {},
  ConnectionIdSchema: {},
  StoredStorageConnectionSchema: { parse: (value: unknown) => value }
}));

vi.mock('$lib/server/auth.js', () => ({
  auth: { api: { updateSession: vi.fn() } }
}));

vi.mock('$lib/server/storage/connections-db.js', () => ({
  isConnectionNameConflict: () => false,
  deleteConnection: vi.fn()
}));

vi.mock('sveltekit-superforms', () => ({
  superValidate: vi.fn(),
  message: vi.fn((form, msg, opts) => ({ form, message: msg, status: opts?.status })),
  setError: vi.fn((form, field, msg) => ({ form, field, error: msg }))
}));

vi.mock('sveltekit-superforms/adapters', () => ({
  zod4: vi.fn((schema) => schema)
}));

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/db.js', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockDbSelect }) }) }),
    update: () => ({ set: () => ({ where: mockDbUpdate }) })
  }
}));

const mockFingerprint = vi.fn(() => 'changed-hash');
vi.mock('$lib/server/storage/encryption.js', () => ({
  encrypt: vi.fn(() => 'encrypted-payload'),
  decrypt: vi.fn((payload: string) => payload),
  fingerprint: () => mockFingerprint()
}));

vi.mock('$lib/server/storage/encryption-key.js', () => ({
  storageEncryptionKey: () => Buffer.alloc(32)
}));

vi.mock('$lib/server/schema.js', () => ({
  userStorageConnections: {}
}));

import { actions } from './+page.server.js';
import { superValidate } from 'sveltekit-superforms';

const storedCredentials = { accessKey: 'stored-ak', secretKey: 'stored-sk' };

const storedPayload = {
  host: 's3.example.com',
  port: 9000,
  accessStyle: 'Path',
  region: { name: 'us-east-1' },
  credentials: storedCredentials
};

function mockForm(credentials = { accessKey: '', secretKey: '' }) {
  vi.mocked(superValidate).mockResolvedValue({
    valid: true,
    data: {
      id: 'conn-1',
      name: 'Renamed',
      type: 's3',
      host: 's3.example.com',
      port: 9000,
      accessStyle: 'Path',
      region: { name: 'us-east-1' },
      credentials
    }
  } as unknown as Awaited<ReturnType<typeof superValidate>>);
}

function mockStoredRow(payload: object = storedPayload) {
  mockDbSelect.mockResolvedValue([
    { encryptedPayload: JSON.stringify(payload), hash: 'stored-hash' }
  ]);
}

function update() {
  return actions.update({
    request: new Request('http://localhost', { method: 'POST' }),
    params: { id: 'conn-1' },
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      user: { id: 'test-user' }
    }
  } as unknown as Parameters<typeof actions.update>[0]);
}

describe('connection edit update action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFingerprint.mockReturnValue('changed-hash');
    mockConnectionProvider.listContainers.mockResolvedValue(['bucket']);
    mockDbUpdate.mockResolvedValue(undefined);
  });

  it('tests the connection with the stored credentials when the fields are blank', async () => {
    mockForm();
    mockStoredRow();

    const result = await update();

    expect(mockGetConnectionProvider).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: storedCredentials })
    );
    expect(result).toMatchObject({ message: { type: 'success' } });
  });

  it('tests a connection without stored credentials anonymously', async () => {
    mockForm();
    mockStoredRow({ ...storedPayload, credentials: undefined });

    await update();

    expect(mockGetConnectionProvider).toHaveBeenCalledWith(
      expect.objectContaining({ credentials: undefined })
    );
  });

  it('skips the connection test when only the name changed', async () => {
    mockForm();
    mockStoredRow();
    mockFingerprint.mockReturnValue('stored-hash');
    mockConnectionProvider.listContainers.mockRejectedValue(new Error('backend down'));

    const result = await update();

    expect(mockConnectionProvider.listContainers).not.toHaveBeenCalled();
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(result).toMatchObject({ message: { type: 'success' } });
  });

  it('does not save when the connection test of changed settings fails', async () => {
    mockForm({ accessKey: 'new-ak', secretKey: 'new-sk' });
    mockStoredRow();
    mockConnectionProvider.listContainers.mockRejectedValue(
      Object.assign(new Error(''), { code: 'ECONNREFUSED' })
    );

    const result = await update();

    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 400,
      message: {
        type: 'error',
        message: 'Could not reach the storage backend — check the host and port.'
      }
    });
  });

  it('requires the secret key when the access key changed', async () => {
    mockForm({ accessKey: 'new-ak', secretKey: '' });
    mockStoredRow();

    const result = await update();

    expect(mockConnectionProvider.listContainers).not.toHaveBeenCalled();
    expect(result).toMatchObject({ field: 'credentials.secretKey' });
  });

  it('returns a not-found message for a missing row', async () => {
    mockForm();
    mockDbSelect.mockResolvedValue([]);

    const result = await update();

    expect(result).toMatchObject({
      status: 404,
      message: { type: 'error', message: 'Connection not found.' }
    });
  });

  it('returns an error message instead of throwing when the update fails', async () => {
    mockForm();
    mockStoredRow();
    mockDbUpdate.mockRejectedValueOnce(new Error('database is locked'));

    const result = await update();

    expect(result).toMatchObject({
      status: 500,
      message: { type: 'error', message: 'Could not save the connection. Please try again.' }
    });
  });
});
