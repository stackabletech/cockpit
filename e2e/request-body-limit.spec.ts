import { test, expect } from './support/fixtures.js';

/**
 * Requests other than uploads are limited to 6 MiB by default (see
 * src/lib/server/request-body-limit.ts), although BODY_SIZE_LIMIT allows 5G for
 * uploads. The limit is checked against Content-Length before any handler
 * reads the body; handlers would answer such a body with 400 instead.
 */
const LIMIT = 6 * 1024 * 1024;
const tooLarge = () => JSON.stringify({ padding: 'x'.repeat(LIMIT + 1024 * 1024) });

function expectRejected(status: number, body: unknown, length: number) {
  expect(status).toBe(413);
  expect(body).toEqual({
    message: `Content-length of ${length} exceeds limit of ${LIMIT} bytes.`
  });
}

test.describe('Request body limit', () => {
  test.describe('without a session', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('rejects a large body to better-auth before it is parsed', async ({ request }) => {
      const data = tooLarge();
      const res = await request.post('/api/auth/sign-in/oauth2', {
        headers: { 'content-type': 'application/json' },
        data
      });

      expectRejected(res.status(), await res.json(), Buffer.byteLength(data));
    });
  });

  test('rejects a large body to an authenticated JSON endpoint', async ({ page }) => {
    const data = tooLarge();
    const res = await page.request.post('/api/bookmarks', {
      headers: { 'content-type': 'application/json' },
      data
    });

    expectRejected(res.status(), await res.json(), Buffer.byteLength(data));
  });

  test('passes a body below the limit to the handler', async ({ page }) => {
    const res = await page.request.post('/api/bookmarks', {
      headers: { 'content-type': 'application/json' },
      data: JSON.stringify({ padding: 'x'.repeat(1024 * 1024) })
    });

    // The handler validates the body, so this is its 400, not the hook's 413.
    expect(res.status()).toBe(400);
  });
});
