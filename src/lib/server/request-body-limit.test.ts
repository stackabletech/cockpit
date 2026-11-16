import { describe, expect, it, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { createMockLogger } from '$lib/test-utils/mock-logger.js';
import { createRequestBodyLimitHandle, deriveRequestBodyLimit } from './request-body-limit.js';

const MiB = 1024 * 1024;
const LIMIT = 6 * MiB;

function run(opts: { path?: string; routeId?: string | null; headers?: Record<string, string> }) {
  const path = opts.path ?? '/api/bookmarks';
  const event = {
    url: new URL(`http://localhost${path}`),
    route: { id: opts.routeId === undefined ? '/(app)/api/bookmarks' : opts.routeId },
    request: { method: 'POST', headers: new Headers(opts.headers) },
    locals: { logger: createMockLogger() }
  } as unknown as RequestEvent;
  const resolve = vi.fn(async () => new Response(null, { status: 204 }));
  const handle = createRequestBodyLimitHandle(LIMIT);
  return { result: handle({ event, resolve }), resolve };
}

describe('deriveRequestBodyLimit', () => {
  it('is 6 MiB for the default editable file size', () => {
    expect(deriveRequestBodyLimit(5 * MiB)).toBe(6 * MiB);
  });

  it('follows a raised editable file size with 1 MiB headroom', () => {
    expect(deriveRequestBodyLimit(20 * MiB)).toBe(21 * MiB);
  });

  it('never drops below 6 MiB', () => {
    expect(deriveRequestBodyLimit(MiB)).toBe(6 * MiB);
  });
});

describe('handleRequestBodyLimit', () => {
  it('passes a body below the limit', async () => {
    const { result, resolve } = run({ headers: { 'content-length': String(LIMIT) } });

    expect((await result).status).toBe(204);
    expect(resolve).toHaveBeenCalled();
  });

  it('passes a request without a body', async () => {
    const { result, resolve } = run({});

    expect((await result).status).toBe(204);
    expect(resolve).toHaveBeenCalled();
  });

  it('rejects an API body above the limit with a JSON 413', async () => {
    const { result, resolve } = run({ headers: { 'content-length': String(LIMIT + 1) } });

    const response = await result;
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      message: `Content-length of ${LIMIT + 1} exceeds limit of ${LIMIT} bytes.`
    });
    expect(response.headers.get('connection')).toBe('close');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects better-auth requests, which reach the API catch-all route', async () => {
    const { result, resolve } = run({
      path: '/api/auth/sign-out',
      routeId: '/(app)/api/[...path]',
      headers: { 'content-length': String(LIMIT + 1) }
    });

    expect((await result).status).toBe(413);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a chunked API body without Content-Length with 411', async () => {
    const { result, resolve } = run({ headers: { 'transfer-encoding': 'chunked' } });

    expect((await result).status).toBe(411);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('throws an HTTP error for a page route above the limit', async () => {
    const { result, resolve } = run({
      path: '/storage',
      routeId: '/(app)/storage',
      headers: { 'content-length': String(LIMIT + 1) }
    });

    await expect(result).rejects.toMatchObject({ status: 413 });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('exempts the upload route', async () => {
    const { result, resolve } = run({
      path: '/api/storage/upload',
      routeId: '/(app)/api/storage/upload',
      headers: { 'content-length': String(10 * LIMIT) }
    });

    expect((await result).status).toBe(204);
    expect(resolve).toHaveBeenCalled();
  });

  it('exempts a chunked upload', async () => {
    const { result, resolve } = run({
      path: '/api/storage/upload',
      routeId: '/(app)/api/storage/upload',
      headers: { 'transfer-encoding': 'chunked' }
    });

    expect((await result).status).toBe(204);
    expect(resolve).toHaveBeenCalled();
  });
});
