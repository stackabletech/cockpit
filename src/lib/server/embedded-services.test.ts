import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: process.env }));

import {
  clearEmbeddedServiceTokenCache,
  configuredEmbeddedServices,
  proxyEmbeddedService
} from './embedded-services.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('embedded service proxy', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    clearEmbeddedServiceTokenCache();
    process.env.STACKABLE_COCKPIT_AIRFLOW_URL = 'http://airflow.test';
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'all-admins';
    delete process.env.STACKABLE_COCKPIT_AIRFLOW_SIMPLE_USERS;
  });

  it('keeps Airflow browser requests same-origin and adds its token upstream', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'airflow-token' }), {
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response('<head></head><base href="/">', {
          headers: {
            'content-type': 'text/html',
            'content-security-policy': "frame-ancestors 'none'",
            'x-frame-options': 'DENY'
          }
        })
      );

    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/ui/'),
      request: new Request('http://cockpit.test/api/services/airflow/ui/'),
      locals: { logger: { debug: vi.fn(), warn: vi.fn() } }
    } as never;

    const response = await proxyEmbeddedService(event, 'airflow');

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      new URL('http://airflow.test/ui/'),
      expect.objectContaining({ headers: expect.any(Headers) })
    );
    expect(fetchMock.mock.calls[1][1].headers.get('authorization')).toBe('Bearer airflow-token');
    expect(response.headers.get('content-security-policy')).toBeNull();
    expect(response.headers.get('x-frame-options')).toBeNull();
    const html = await response.text();
    expect(html).toContain(
      "history.replaceState(null, '', '/api/services/airflow/' + location.search + location.hash)"
    );
    expect(html).toContain('<base href="/api/services/airflow/"');
  });

  it('keeps upstream Airflow redirects on the service route', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'airflow-token' }), {
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: 'http://airflow.test/auth/login?next=%2F' }
        })
      );

    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/'),
      request: new Request('http://cockpit.test/api/services/airflow/'),
      locals: { logger: { debug: vi.fn(), warn: vi.fn() } }
    } as never;

    const response = await proxyEmbeddedService(event, 'airflow');

    expect(response.headers.get('location')).toBe('/api/services/airflow/auth/login?next=%2F');
  });

  it('does not forward encoding metadata after Node decompresses an asset', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'airflow-token' }), {
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(
        new Response('export {}', {
          headers: {
            'content-encoding': 'gzip',
            'content-length': '999',
            'content-type': 'application/javascript'
          }
        })
      );

    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/static/index.js'),
      request: new Request('http://cockpit.test/api/services/airflow/static/index.js'),
      locals: { logger: { debug: vi.fn(), warn: vi.fn() } }
    } as never;

    const response = await proxyEmbeddedService(event, 'airflow');

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.headers.get('content-length')).toBeNull();
    expect(response.headers.get('content-type')).toBe('application/javascript');
  });

  it('forwards the session identity instead of a token in sso mode', async () => {
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'sso';
    fetchMock.mockResolvedValueOnce(
      new Response('<head></head>', { headers: { 'content-type': 'text/html' } })
    );

    const request = new Request('http://cockpit.test/api/services/airflow/', {
      headers: {
        'x-forwarded-preferred-username': 'mallory',
        'x-forwarded-email': 'mallory@example.com',
        accept: 'text/html'
      }
    });
    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/'),
      request,
      locals: {
        logger: { debug: vi.fn(), warn: vi.fn() },
        user: { name: 'Alice Example', email: 'alice@example.com', username: 'alice' }
      }
    } as never;

    await proxyEmbeddedService(event, 'airflow');

    // Only one fetch: no /auth/token round-trip in sso mode.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const upstreamHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(upstreamHeaders.get('authorization')).toBeNull();
    expect(upstreamHeaders.get('x-forwarded-preferred-username')).toBe('alice');
    expect(upstreamHeaders.get('x-forwarded-email')).toBe('alice@example.com');
  });

  it('strips spoofed inbound X-Forwarded-* identity headers', async () => {
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'sso';
    fetchMock.mockResolvedValueOnce(
      new Response('<head></head>', { headers: { 'content-type': 'text/html' } })
    );

    const request = new Request('http://cockpit.test/api/services/airflow/', {
      headers: { 'x-forwarded-preferred-username': 'admin' }
    });
    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/'),
      request,
      locals: {
        logger: { debug: vi.fn(), warn: vi.fn() },
        user: { name: 'Bob', email: 'bob@example.com', username: 'bob' }
      }
    } as never;

    await proxyEmbeddedService(event, 'airflow');

    const upstreamHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(upstreamHeaders.get('x-forwarded-preferred-username')).toBe('bob');
  });

  it('mints a per-user token from the session identity in simple-users mode', async () => {
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'simple-users';
    process.env.STACKABLE_COCKPIT_AIRFLOW_SIMPLE_USERS = 'Alice:pw-alice,bob:pw-bob';
    const makeToken = () =>
      [
        'e30',
        Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
          'base64url'
        ),
        'sig'
      ].join('.');
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: makeToken() }), {
          status: 201,
          headers: { 'content-type': 'application/json' }
        })
      )
      .mockResolvedValueOnce(new Response('ok'));

    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/api/v2/dags'),
      request: new Request('http://cockpit.test/api/services/airflow/api/v2/dags'),
      locals: {
        logger: { debug: vi.fn(), warn: vi.fn() },
        user: { name: 'Alice Example', email: 'alice@example.com', username: 'alice' }
      }
    } as never;

    await proxyEmbeddedService(event, 'airflow');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(tokenUrl).toEqual(new URL('http://airflow.test/auth/token'));
    expect(tokenInit.method).toBe('POST');
    expect(JSON.parse(tokenInit.body)).toEqual({ username: 'alice', password: 'pw-alice' });
    const upstreamHeaders = fetchMock.mock.calls[1][1].headers as Headers;
    expect(upstreamHeaders.get('authorization')).toMatch(/^Bearer /);
  });

  it('caches the per-user token across requests until it nears expiry', async () => {
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'simple-users';
    process.env.STACKABLE_COCKPIT_AIRFLOW_SIMPLE_USERS = 'alice:pw-alice';
    const token = [
      'e30',
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        'base64url'
      ),
      'sig'
    ].join('.');
    // Only one /auth/token round-trip is expected; data requests answer plainly.
    fetchMock.mockImplementation((input: RequestInfo | URL) =>
      Promise.resolve(
        String(input).endsWith('/auth/token')
          ? new Response(JSON.stringify({ access_token: token }), {
              status: 201,
              headers: { 'content-type': 'application/json' }
            })
          : new Response('ok')
      )
    );

    const event = () =>
      ({
        url: new URL('http://cockpit.test/api/services/airflow/api/v2/dags'),
        request: new Request('http://cockpit.test/api/services/airflow/api/v2/dags'),
        locals: {
          logger: { debug: vi.fn(), warn: vi.fn() },
          user: { name: 'alice', username: 'alice' }
        }
      }) as never;

    await proxyEmbeddedService(event(), 'airflow');
    await proxyEmbeddedService(event(), 'airflow');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/auth/token'))
    ).toHaveLength(1);
  });

  it('rejects users without an embedded-service account in simple-users mode', async () => {
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'simple-users';
    process.env.STACKABLE_COCKPIT_AIRFLOW_SIMPLE_USERS = 'alice:pw-alice';

    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/'),
      request: new Request('http://cockpit.test/api/services/airflow/'),
      locals: {
        logger: { debug: vi.fn(), warn: vi.fn() },
        user: { name: 'Mallory', email: 'mallory@example.com', username: 'mallory' }
      }
    } as never;

    await expect(proxyEmbeddedService(event, 'airflow')).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects sso proxying without an authenticated cockpit session', async () => {
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'sso';

    const event = {
      url: new URL('http://cockpit.test/api/services/airflow/'),
      request: new Request('http://cockpit.test/api/services/airflow/'),
      locals: { logger: { debug: vi.fn(), warn: vi.fn() }, user: null }
    } as never;

    await expect(proxyEmbeddedService(event, 'airflow')).rejects.toMatchObject({
      status: 401
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies any configured product without authentication in none mode', async () => {
    process.env.STACKABLE_COCKPIT_SUPERSET_URL = 'http://superset.test';
    delete process.env.STACKABLE_COCKPIT_SUPERSET_AUTH_MODE;
    fetchMock.mockResolvedValueOnce(
      new Response('<head></head>', { headers: { 'content-type': 'text/html' } })
    );

    const event = {
      url: new URL('http://cockpit.test/api/services/superset/dashboard/1/'),
      request: new Request('http://cockpit.test/api/services/superset/dashboard/1/'),
      locals: { logger: { debug: vi.fn(), warn: vi.fn() } }
    } as never;

    const response = await proxyEmbeddedService(event, 'superset');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://superset.test/dashboard/1/'),
      expect.objectContaining({ headers: expect.any(Headers) })
    );
    const upstreamHeaders = fetchMock.mock.calls[0][1].headers as Headers;
    expect(upstreamHeaders.get('authorization')).toBeNull();
    expect(response.status).toBe(200);
    delete process.env.STACKABLE_COCKPIT_SUPERSET_URL;
  });

  it('rejects service ids that are not simple identifiers', async () => {
    const event = {
      url: new URL('http://cockpit.test/api/services/..%2Fsecret/'),
      request: new Request('http://cockpit.test/api/services/x/'),
      locals: { logger: { debug: vi.fn(), warn: vi.fn() } }
    } as never;

    await expect(proxyEmbeddedService(event, '../secret')).rejects.toMatchObject({
      status: 404
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists every product with a configured upstream URL', () => {
    process.env.STACKABLE_COCKPIT_SUPERSET_URL = 'http://superset.test';
    process.env.STACKABLE_COCKPIT_SPARK_HISTORY_URL = 'http://spark.test';
    delete process.env.STACKABLE_COCKPIT_NIFI_URL;

    expect(configuredEmbeddedServices()).toEqual(
      expect.arrayContaining(['airflow', 'superset', 'spark-history'])
    );
    expect(configuredEmbeddedServices()).not.toContain('nifi');
    delete process.env.STACKABLE_COCKPIT_SUPERSET_URL;
    delete process.env.STACKABLE_COCKPIT_SPARK_HISTORY_URL;
  });
});
