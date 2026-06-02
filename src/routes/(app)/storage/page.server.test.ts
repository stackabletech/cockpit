import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/storage/service.js', () => ({
  listBuckets: vi.fn()
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
import { listBuckets } from '$lib/server/storage/service.js';
import { superValidate } from 'sveltekit-superforms';

function mockLocals() {
  return { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } };
}

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
      data: {
        type: 'hdfs',
        endpoint: '',
        pathStyle: false,
        region: '',
        accessKeyId: '',
        secretAccessKey: ''
      }
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
        endpoint: 'http://s3',
        pathStyle: true,
        region: 'us-east-1',
        accessKeyId: 'ak',
        secretAccessKey: 'sk'
      }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    vi.mocked(listBuckets).mockRejectedValue(new Error('connection refused'));

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
        endpoint: 'http://s3',
        pathStyle: true,
        region: 'us-east-1',
        accessKeyId: 'ak',
        secretAccessKey: 'sk'
      }
    } as unknown as Awaited<ReturnType<typeof superValidate>>);
    vi.mocked(listBuckets).mockResolvedValue(['b1']);

    await expect(
      actions.connect({
        request: new Request('http://localhost', { method: 'POST' }),
        locals: mockLocals()
      } as unknown as Parameters<typeof actions.connect>[0])
    ).rejects.toThrow(expect.objectContaining({ status: 303, location: '/storage' }));
  });

  it('disconnect: redirects', async () => {
    await expect(
      actions.disconnect({ locals: mockLocals() } as unknown as Parameters<
        typeof actions.disconnect
      >[0])
    ).rejects.toThrow(
      expect.objectContaining({ status: 303, location: '/storage?disconnected=1' })
    );
  });
});
