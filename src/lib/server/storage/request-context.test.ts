import { describe, it, expect } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { requireObjectKey } from './request-context.js';

function eventWithQuery(params: Record<string, string>): RequestEvent {
  const url = new URL('http://localhost/api/storage/details');
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return { url } as RequestEvent;
}

describe('requireObjectKey', () => {
  it('returns the key unchanged, including characters S3 accepts', () => {
    const key = ' reports?2024/../a\\b/new.txt ';
    expect(requireObjectKey(eventWithQuery({ key }))).toBe(key);
  });

  it('rejects a missing key with 400', () => {
    expect(() => requireObjectKey(eventWithQuery({}))).toThrow(
      expect.objectContaining({
        status: 400,
        body: { message: 'Missing required query parameter: key' }
      })
    );
  });

  it('rejects an empty key with 400', () => {
    expect(() => requireObjectKey(eventWithQuery({ key: '' }))).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it.each([
    ['too long', 'a'.repeat(1025)],
    ['with control characters', 'a\nb']
  ])('rejects a key %s with 400', (_, key) => {
    expect(() => requireObjectKey(eventWithQuery({ key }))).toThrow(
      expect.objectContaining({ status: 400, body: { message: 'Invalid query parameter: key' } })
    );
  });
});
