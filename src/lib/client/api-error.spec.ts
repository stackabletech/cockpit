import { describe, expect, it } from 'vitest';
import { readErrorMessage } from './api-error.js';

describe('readErrorMessage', () => {
  it('returns the message of an App.Error body', async () => {
    const res = Response.json({ message: 'Invalid JSON body' }, { status: 400 });

    expect(await readErrorMessage(res)).toBe('Invalid JSON body');
  });

  it.each([
    ['an HTML page', '<!doctype html><html></html>'],
    ['an empty body', ''],
    ['JSON without a message', '{"error":"nope"}']
  ])('returns null for %s', async (_label, body) => {
    expect(await readErrorMessage(new Response(body, { status: 502 }))).toBeNull();
  });
});
