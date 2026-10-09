import { describe, it, expect, vi, beforeEach } from 'vitest';
import { stringify } from 'devalue';

vi.mock('$lib/server/storage/service.js', () => ({
  listBuckets: vi.fn()
}));

import { load, actions } from './+page.server.js';
import { listBuckets } from '$lib/server/storage/service.js';

type LoadEvent = Parameters<typeof load>[0];
type ConnectEvent = Parameters<typeof actions.connect>[0];
type DisconnectEvent = Parameters<typeof actions.disconnect>[0];

function mockLocals() {
  return { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } };
}

/** Build a POST request the way the client-side form sends it (`dataType: 'json'`). */
function formRequest(data: Record<string, unknown>): Request {
  const body = new FormData();
  body.append('__superform_json', stringify(data));
  return new Request('http://localhost/storage?/connect', { method: 'POST', body });
}

function connect(data: Record<string, unknown>) {
  return actions.connect({
    request: formRequest(data),
    locals: mockLocals()
  } as unknown as ConnectEvent);
}

const validS3 = {
  type: 's3',
  host: 's3.example.com',
  accessStyle: 'Path',
  region: { name: 'us-east-1' },
  credentials: { accessKey: 'ak', secretKey: 'sk' }
};

describe('storage page load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty connection form with TLS verification enabled', async () => {
    const result = await load({ locals: mockLocals() } as unknown as LoadEvent);
    expect(result?.connectionForm.data.tls).toEqual({ verification: 'Full' });
    expect(result?.connectionForm.errors).toEqual({});
  });
});

describe('storage page actions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('connect: returns fail(400) with field errors on invalid form', async () => {
    const result = await connect({ ...validS3, host: '' });
    expect(result).toMatchObject({ status: 400 });
    expect(result).toHaveProperty('data.form.errors.host');
    expect(listBuckets).not.toHaveBeenCalled();
  });

  it('connect: rejects an access key without a secret key', async () => {
    const result = await connect({ ...validS3, credentials: { accessKey: 'ak', secretKey: '' } });
    expect(result).toMatchObject({ status: 400 });
    expect(result).toHaveProperty('data.form.errors.credentials.secretKey');
  });

  it('connect: strips the scheme from the host', async () => {
    vi.mocked(listBuckets).mockResolvedValue(['b1']);
    await expect(connect({ ...validS3, host: 'https://s3.example.com/' })).rejects.toMatchObject({
      status: 303
    });
    expect(listBuckets).toHaveBeenCalledWith(expect.objectContaining({ host: 's3.example.com' }));
  });

  it('connect: returns message for non-s3 type', async () => {
    const result = await connect({ ...validS3, type: 'hdfs' });
    expect(result).toMatchObject({ status: 400 });
    expect(result).toHaveProperty('data.form.message', {
      type: 'error',
      message: 'HDFS connections are not yet supported.'
    });
  });

  it('connect: returns error message on connection test failure', async () => {
    vi.mocked(listBuckets).mockRejectedValue(new Error('connection refused'));

    const result = await connect(validS3);
    expect(result).toMatchObject({ status: 400 });
    expect(result).toHaveProperty('data.form.message', {
      type: 'error',
      message: 'Could not connect — check the endpoint and credentials.'
    });
  });

  it('connect: redirects on success', async () => {
    vi.mocked(listBuckets).mockResolvedValue(['b1']);

    await expect(connect(validS3)).rejects.toMatchObject({ status: 303, location: '/storage' });
    expect(listBuckets).toHaveBeenCalledWith({
      type: 's3',
      host: 's3.example.com',
      port: undefined,
      tls: undefined,
      accessStyle: 'Path',
      region: { name: 'us-east-1' },
      credentials: { accessKey: 'ak', secretKey: 'sk' }
    });
  });

  it('disconnect: redirects', async () => {
    await expect(
      actions.disconnect({ locals: mockLocals() } as unknown as DisconnectEvent)
    ).rejects.toMatchObject({ status: 303, location: '/storage?disconnected=1' });
  });
});
