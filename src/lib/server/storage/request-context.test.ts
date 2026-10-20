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

  it.each(['tab\tname', 'new\nline', 'carriage\rreturn', 'start\u0001of heading'])(
    'accepts the control-character key %j, as S3 does',
    (key) => {
      expect(requireObjectKey(eventWithQuery({ key }))).toBe(key);
    }
  );

  it('rejects a key longer than 1024 bytes with 400', () => {
    expect(() => requireObjectKey(eventWithQuery({ key: 'a'.repeat(1025) }))).toThrow(
      expect.objectContaining({ status: 400, body: { message: 'Invalid query parameter: key' } })
    );
  });
});
