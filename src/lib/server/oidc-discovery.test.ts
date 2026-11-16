import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/logging', () => import('$lib/test-utils/mock-logger.js'));

import { logger } from '$lib/server/logging';
import { checkOidcDiscovery } from './oidc-discovery.js';

const DISCOVERY_URL = 'https://idp.example.com/.well-known/openid-configuration';
const log = logger.child({});

function fetchError(code: string, message: string) {
  return new TypeError('fetch failed', { cause: Object.assign(new Error(message), { code }) });
}

describe('checkOidcDiscovery', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('logs a reachable provider', async () => {
    fetchMock.mockResolvedValue(Response.json({ authorization_endpoint: 'https://idp/auth' }));

    await checkOidcDiscovery(DISCOVERY_URL);

    expect(log.info).toHaveBeenCalledWith(
      { discovery_url: DISCOVERY_URL },
      'OIDC provider reachable'
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('names an untrusted provider certificate and the setting that fixes it', async () => {
    fetchMock.mockRejectedValue(
      fetchError('UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'unable to verify the first certificate')
    );

    await checkOidcDiscovery(DISCOVERY_URL);

    expect(log.error).toHaveBeenCalledWith(
      {
        discovery_url: DISCOVERY_URL,
        error_code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        error: 'unable to verify the first certificate'
      },
      expect.stringContaining('add its CA to STACKABLE_COCKPIT_TLS_CA_CERTS')
    );
  });

  it('logs the cause of other connection errors as a warning', async () => {
    fetchMock.mockRejectedValue(fetchError('ENOTFOUND', 'getaddrinfo ENOTFOUND idp'));

    await checkOidcDiscovery(DISCOVERY_URL);

    expect(log.warn).toHaveBeenCalledWith(
      { discovery_url: DISCOVERY_URL, error_code: 'ENOTFOUND', error: 'getaddrinfo ENOTFOUND idp' },
      'OIDC discovery failed'
    );
    expect(log.error).not.toHaveBeenCalled();
  });

  it('logs an error response', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));

    await checkOidcDiscovery(DISCOVERY_URL);

    expect(log.warn).toHaveBeenCalledWith(
      { discovery_url: DISCOVERY_URL, status_code: 404 },
      expect.stringContaining('OIDC discovery failed')
    );
  });

  it('logs a response that is no discovery document', async () => {
    fetchMock.mockResolvedValue(Response.json({ hello: 'world' }));

    await checkOidcDiscovery(DISCOVERY_URL);

    expect(log.warn).toHaveBeenCalledWith(
      { discovery_url: DISCOVERY_URL },
      expect.stringContaining('no OIDC discovery document')
    );
    expect(log.info).not.toHaveBeenCalled();
  });
});
