import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/storage/service.js', () => ({
  listObjects: vi.fn()
}));

vi.mock('$lib/server/auth-utils.js', () => ({
  getUserId: vi.fn(() => 'test-user')
}));

import { load } from './+page.server.js';
import { listObjects } from '$lib/server/storage/service.js';

function mockEvent(
  opts: { bucket?: string; prefix?: string; searchParams?: Record<string, string> } = {}
) {
  const url = new URL('http://localhost/storage/b1/some/prefix');
  for (const [k, v] of Object.entries(opts.searchParams ?? {})) {
    url.searchParams.set(k, v);
  }
  return {
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } },
    params: { bucket: opts.bucket ?? 'my-bucket', prefix: opts.prefix ?? '' },
    url
  } as any;
}

describe('bucket page load', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists objects with default page size', async () => {
    vi.mocked(listObjects).mockResolvedValue({ items: [], prefixes: [] } as any);

    const result = await load(mockEvent());

    expect(listObjects).toHaveBeenCalledWith('test-user', 'my-bucket', '', 25, undefined);
    expect(result.bucket).toBe('my-bucket');
    expect(result.prefix).toBe('');
  });

  it('adds trailing slash to prefix', async () => {
    vi.mocked(listObjects).mockResolvedValue({ items: [] } as any);

    await load(mockEvent({ prefix: 'data/2024' }));

    expect(listObjects).toHaveBeenCalledWith('test-user', 'my-bucket', 'data/2024/', 25, undefined);
  });

  it('passes continuationToken and pageSize', async () => {
    vi.mocked(listObjects).mockResolvedValue({ items: [] } as any);

    await load(mockEvent({ searchParams: { continuationToken: 'abc', pageSize: '50' } }));

    expect(listObjects).toHaveBeenCalledWith('test-user', 'my-bucket', '', 50, 'abc');
  });
});
