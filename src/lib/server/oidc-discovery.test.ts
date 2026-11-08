import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

import { logger } from '$lib/server/logging';

const DISCOVERY_URL = 'https://idp.example.com/.well-known/openid-configuration';
const log = logger.child({});

/** Fresh module per test: a successful discovery is remembered. */
async function check() {
  const { checkOidcDiscovery } = await import('./oidc-discovery.js');
  return checkOidcDiscovery(DISCOVERY_URL);
}

function fetchError(code: string, message: string) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
}

describe('checkOidcDiscovery', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('succeeds for a discovery document and remembers it', async () => {
    fetchMock.mockResolvedValue(Response.json({ authorization_endpoint: 'https://idp/auth' }));

    const { checkOidcDiscovery } = await import('./oidc-discovery.js');
    expect(await checkOidcDiscovery(DISCOVERY_URL)).toBe(true);
    expect(await checkOidcDiscovery(DISCOVERY_URL)).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(log.info).toHaveBeenCalledWith(
      { discovery_url: DISCOVERY_URL },
      'OIDC provider reachable'
    );
  });

  it('names an untrusted provider certificate and the setting that fixes it', async () => {
    fetchMock.mockRejectedValue(
      fetchError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate')
    );

    expect(await check()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      {
        discovery_url: DISCOVERY_URL,
        error_code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        error: 'unable to verify the first certificate'
      },
      expect.stringContaining('add its CA to STACKABLE_COCKPIT_TLS_CA_CERTS')
    );
  });

  it('logs the cause of other connection errors and retries on the next check', async () => {
    fetchMock.mockRejectedValueOnce(fetchError('ENOTFOUND', 'getaddrinfo ENOTFOUND idp'));
    fetchMock.mockResolvedValueOnce(Response.json({ authorization_endpoint: 'https://idp/auth' }));

    const { checkOidcDiscovery } = await import('./oidc-discovery.js');
    expect(await checkOidcDiscovery(DISCOVERY_URL)).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      { discovery_url: DISCOVERY_URL, error_code: 'ENOTFOUND', error: 'getaddrinfo ENOTFOUND idp' },
      'OIDC discovery failed'
    );
    expect(await checkOidcDiscovery(DISCOVERY_URL)).toBe(true);
  });

  it('fails on an error response', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));

    expect(await check()).toBe(false);
    expect(log.warn).toHaveBeenCalledWith(
      { discovery_url: DISCOVERY_URL, status_code: 404 },
      expect.stringContaining('OIDC discovery failed')
    );
  });

  it('fails when the response is no discovery document', async () => {
    fetchMock.mockResolvedValue(Response.json({ hello: 'world' }));

    expect(await check()).toBe(false);
  });
});
