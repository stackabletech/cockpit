import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/storage/service.js', () => ({
  getConnection: vi.fn(),
  saveConnection: vi.fn(),
  clearConnection: vi.fn(),
  listBuckets: vi.fn()
}));

vi.mock('$lib/server/auth-utils.js', () => ({
  getUserId: vi.fn(() => 'test-user')
}));

vi.mock('$lib/storage/schemas.js', () => ({
  StorageConnectionSchema: {} // superValidate is also mocked
}));

vi.mock('sveltekit-superforms', () => ({
  superValidate: vi.fn(),
  message: vi.fn((form, msg, opts) => ({ form, message: msg, status: opts?.status }))
}));

vi.mock('sveltekit-superforms/adapters', () => ({
  zod4: vi.fn((schema) => schema)
}));

import { load, actions } from './+page.server.js';
import {
  getConnection,
  saveConnection,
  clearConnection,
  listBuckets
} from '$lib/server/storage/service.js';
import { superValidate } from 'sveltekit-superforms';

function mockLocals() {
  return { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } };
}

describe('storage page load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns connectionForm and connected status', async () => {
    vi.mocked(superValidate).mockResolvedValue({ data: {} } as any);
    vi.mocked(getConnection).mockReturnValue({ type: 's3' } as any);

    const result = await load({ locals: mockLocals() } as any);
    expect(result.connected).toBe(true);
    expect(result.connectionForm).toBeDefined();
  });
});

describe('storage page actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('connect: returns fail(400) on invalid form', async () => {
    vi.mocked(superValidate).mockResolvedValue({ valid: false, errors: {} } as any);

    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: mockLocals()
    } as any);
    expect(result?.status).toBe(400);
  });

  it('connect: returns message for non-s3 type', async () => {
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: {
        type: 'hdfs',
        endpoint: '',
        pathStyle: false,
        region: '',
        accessKeyId: '',
        secretAccessKey: ''
      }
    } as any);

    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: mockLocals()
    } as any);
    expect(result).toHaveProperty('message', 'HDFS connections are not yet supported');
  });

  it('connect: clears connection and returns error on test failure', async () => {
    vi.mocked(superValidate).mockResolvedValue({
      valid: true,
      data: {
        type: 's3',
        endpoint: 'http://s3',
        pathStyle: true,
        region: 'us-east-1',
        accessKeyId: 'ak',
        secretAccessKey: 'sk'
      }
    } as any);
    vi.mocked(listBuckets).mockRejectedValue(new Error('connection refused'));

    const result = await actions.connect({
      request: new Request('http://localhost', { method: 'POST' }),
      locals: mockLocals()
    } as any);
    expect(clearConnection).toHaveBeenCalledWith('test-user');
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
        endpoint: 'http://s3',
        pathStyle: true,
        region: 'us-east-1',
        accessKeyId: 'ak',
        secretAccessKey: 'sk'
      }
    } as any);
    vi.mocked(listBuckets).mockResolvedValue(['b1']);

    await expect(
      actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: mockLocals()
      } as any)
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
  });

  it('disconnect: clears connection and redirects', async () => {
    await expect(actions.disconnect({ locals: mockLocals() } as any)).rejects.toThrow(
      expect.objectContaining({ status: 303, location: '/storage?disconnected=1' })
    );
    expect(clearConnection).toHaveBeenCalledWith('test-user');
  });
});
