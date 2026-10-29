import { describe, expect, it } from 'vitest';
import { readErrorMessage } from './api-error.js';

describe('readErrorMessage', () => {
  it('returns the message of an App.Error body', async () => {
    const res = Response.json({ message: 'Invalid JSON body' }, { status: 400 });

    expect(await readErrorMessage(res)).toBe('Invalid JSON body');
  });

  it.each([
    ['an HTML page', 502, '<!doctype html><html></html>'],
    ['an empty body', 502, ''],
    ['JSON without a message', 502, '{"error":"nope"}'],
    ['an expired session', 401, '{"message":"Authentication required"}'],
    ['an unexpected error', 500, '{"message":"An unexpected error occurred","requestId":"r1"}']
  ])('returns null for %s', async (_label, status, body) => {
    expect(await readErrorMessage(new Response(body, { status }))).toBeNull();
  });
});
