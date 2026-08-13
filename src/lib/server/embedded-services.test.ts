import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: process.env }));

import { proxyEmbeddedService } from './embedded-services.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('embedded service proxy', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    process.env.STACKABLE_COCKPIT_AIRFLOW_URL = 'http://airflow.test';
    process.env.STACKABLE_COCKPIT_AIRFLOW_AUTH_MODE = 'all-admins';
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
});
