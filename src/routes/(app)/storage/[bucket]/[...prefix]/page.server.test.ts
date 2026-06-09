import { describe, it, expect } from 'vitest';

import { load } from './+page.server.js';

function mockEvent(opts: { bucket?: string; prefix?: string } = {}) {
  return {
    locals: { logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, user: { id: 'test-user' } },
    params: { bucket: opts.bucket ?? 'my-bucket', prefix: opts.prefix ?? '' }
  } as unknown as Parameters<typeof load>[0];
}

import { vi } from 'vitest';

describe('bucket page server load', () => {
  it('returns bucket and prefix', async () => {
    const result = await load(mockEvent());
    expect(result).toEqual({ bucket: 'my-bucket', prefix: '' });
  });

  it('adds trailing slash to prefix', async () => {
    const result = await load(mockEvent({ prefix: 'data/2024' }));
    expect(result).toEqual({ bucket: 'my-bucket', prefix: 'data/2024/' });
  });

  it('handles empty prefix', async () => {
    const result = await load(mockEvent({ bucket: 'test-bucket', prefix: '' }));
    expect(result).toEqual({ bucket: 'test-bucket', prefix: '' });
  });
});
