import { describe, it, expect, vi } from 'vitest';

import { load } from './+page.server.js';

function mockEvent(
  opts: {
    bucket?: string;
    prefix?: string;
    activeConnectionId?: string | null;
    session?: Record<string, unknown> | null;
  } = {}
) {
  const session =
    opts.session !== undefined
      ? opts.session
      : opts.activeConnectionId === undefined
        ? { activeStorageConnectionId: null }
        : { activeStorageConnectionId: opts.activeConnectionId };

  return {
    locals: {
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
      user: { id: 'test-user' },
      session
    },
    params: { bucket: opts.bucket ?? 'my-bucket', prefix: opts.prefix ?? '' }
  } as unknown as Parameters<typeof load>[0];
}

describe('bucket page server load', () => {
  it('returns bucket and prefix when an active connection exists', async () => {
    const result = await load(mockEvent({ activeConnectionId: 'conn-123' }));
    expect(result).toEqual({ bucket: 'my-bucket', prefix: '', activeConnectionId: 'conn-123' });
  });

  it('redirects to /storage when no active connection', async () => {
    await expect(load(mockEvent({ activeConnectionId: null }))).rejects.toThrow(
      expect.objectContaining({ status: 303, location: '/storage' })
    );
  });

  it('redirects to /storage when activeConnectionId is absent from session', async () => {
    await expect(load(mockEvent({ session: null }))).rejects.toThrow(
      expect.objectContaining({ status: 303, location: '/storage' })
    );
  });

  it('adds trailing slash to prefix', async () => {
    const result = await load(mockEvent({ prefix: 'data/2024', activeConnectionId: 'conn-123' }));
    expect(result).toEqual({
      bucket: 'my-bucket',
      prefix: 'data/2024/',
      activeConnectionId: 'conn-123'
    });
  });

  it('handles empty prefix', async () => {
    const result = await load(
      mockEvent({ bucket: 'test-bucket', prefix: '', activeConnectionId: 'conn-123' })
    );
    expect(result).toEqual({ bucket: 'test-bucket', prefix: '', activeConnectionId: 'conn-123' });
  });
});
