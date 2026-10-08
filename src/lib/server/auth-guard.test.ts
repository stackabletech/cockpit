import { describe, expect, it } from 'vitest';
import { isRedirect } from '@sveltejs/kit';
import { unauthenticatedResponse } from './auth-guard.js';

describe('unauthenticatedResponse', () => {
  it('returns a JSON 401 for API routes', async () => {
    const res = unauthenticatedResponse(
      new URL('http://localhost/api/trino/catalog?level=catalogs')
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ message: 'Authentication required' });
  });

  it('redirects page routes to the login page, preserving the target', () => {
    try {
      unauthenticatedResponse(new URL('http://localhost/trino?tab=1'));
      expect.unreachable('expected a redirect to be thrown');
    } catch (err) {
      expect(isRedirect(err)).toBe(true);
      if (!isRedirect(err)) return;
      expect(err.status).toBe(302);
      expect(err.location).toBe('/auth/login?redirectTo=%2Ftrino%3Ftab%3D1');
    }
  });

  it('does not treat paths that merely start with "api" as API routes', () => {
    expect(() => unauthenticatedResponse(new URL('http://localhost/apis'))).toThrow();
  });
});
