import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStorageFetch, mapStatusToCode } from './storage-fetch.js';
import { StorageError } from './errors.js';
import { STORAGE_CONNECTION_ID_HEADER } from './connection-id-header.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeResponse(opts?: { status?: number; body?: string }): Response {
  return new Response(opts?.body ?? null, {
    status: opts?.status ?? 200
  });
}

// ── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mapStatusToCode', () => {
  it('maps 401 → not_connected', () => {
    expect(mapStatusToCode(401)).toBe('not_connected');
  });

  it('maps 403 → access_denied', () => {
    expect(mapStatusToCode(403)).toBe('access_denied');
  });

  it('maps 404 → not_found', () => {
    expect(mapStatusToCode(404)).toBe('not_found');
  });

  it('maps 500 → server_error', () => {
    expect(mapStatusToCode(500)).toBe('server_error');
  });

  it('maps 502 → server_error', () => {
    expect(mapStatusToCode(502)).toBe('server_error');
  });

  it('maps 503 → server_error', () => {
    expect(mapStatusToCode(503)).toBe('server_error');
  });

  it('maps 200 → unknown', () => {
    expect(mapStatusToCode(200)).toBe('unknown');
  });

  it('maps 400 → unknown', () => {
    expect(mapStatusToCode(400)).toBe('unknown');
  });
});

describe('createStorageFetch', () => {
  it('throws StorageError with not_connected when getConnectionId returns null', async () => {
    const storageFetch = createStorageFetch(() => null);

    await expect(storageFetch('/api/test')).rejects.toThrow(StorageError);
    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'not_connected'
    });
  });

  it('throws StorageError with not_connected when getConnectionId returns undefined', async () => {
    const storageFetch = createStorageFetch(() => undefined as unknown as string | null);

    await expect(storageFetch('/api/test')).rejects.toThrow(StorageError);
    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'not_connected'
    });
  });

  it('sets the connection ID header on the request', async () => {
    const storageFetch = createStorageFetch(() => 'test-conn-id');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse());

    await storageFetch('/api/storage/list?bucket=test');

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get(STORAGE_CONNECTION_ID_HEADER)).toBe('test-conn-id');
  });

  it('preserves custom headers from the caller', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse());

    await storageFetch('/api/test', {
      headers: { 'X-Custom': 'value' },
      method: 'POST'
    });

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('X-Custom')).toBe('value');
    expect(headers.get(STORAGE_CONNECTION_ID_HEADER)).toBe('conn-1');
  });

  it('returns the response on success', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    const body = JSON.stringify({ ok: true });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ body }));

    const res = await storageFetch('/api/test');
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('throws StorageError on 403 with access_denied code', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ status: 403 }));

    await expect(storageFetch('/api/test')).rejects.toThrow(StorageError);
    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'access_denied'
    });
  });

  it('throws StorageError on 404 with not_found code', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ status: 404 }));

    await expect(storageFetch('/api/test')).rejects.toThrow(StorageError);
    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'not_found'
    });
  });

  it('preserves an API error message', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({ status: 404, body: JSON.stringify({ message: 'reports/moved.txt' }) })
    );

    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'not_found',
      message: 'reports/moved.txt'
    });
  });

  it('throws StorageError on 500 with server_error code', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ status: 500 }));

    await expect(storageFetch('/api/test')).rejects.toThrow(StorageError);
    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'server_error'
    });
  });

  it('throws StorageError on 401 with not_connected code', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ status: 401 }));

    await expect(storageFetch('/api/test')).rejects.toThrow(StorageError);
    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'not_connected'
    });
  });

  it('throws StorageError on 400 with unknown code', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse({ status: 400 }));

    await expect(storageFetch('/api/test')).rejects.toMatchObject({
      code: 'unknown'
    });
  });

  it('calls fetch with the correct path', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse());

    await storageFetch('/api/storage/list?bucket=my-bucket&prefix=foo/');

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/storage/list?bucket=my-bucket&prefix=foo/',
      expect.objectContaining({ headers: expect.any(Headers) })
    );
  });

  it('forwards body and method from init', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse());
    const body = JSON.stringify({ sourceKeys: ['a.txt'], destinationPrefix: 'dest/' });

    await storageFetch('/api/storage/copy?bucket=b', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(body);
  });

  it('forwards AbortSignal', async () => {
    const storageFetch = createStorageFetch(() => 'conn-1');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse());
    const controller = new AbortController();

    await storageFetch('/api/test', { signal: controller.signal });

    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init?.signal).toBe(controller.signal);
  });
});
