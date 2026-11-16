// Checks once at startup that the OIDC provider is reachable. better-auth only logs
// "fetch failed" when discovery fails, which hides the cause, e.g. a certificate
// signed by an untrusted CA.

import { logger } from '$lib/server/logging';

const log = logger.child({ module: 'oidc-discovery' });

const DISCOVERY_TIMEOUT_MS = 5_000;

// TLS errors that mean the provider's certificate chain isn't trusted.
const UNTRUSTED_CERTIFICATE_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'DEPTH_ZERO_SELF_SIGNED_CERT'
]);

/** Error details from fetch, which wraps the actual cause (TLS, DNS, connection). */
function describeFetchError(err: unknown) {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  return {
    error_code: cause?.code ?? (err as { name?: string }).name,
    error: cause?.message ?? (err as Error).message
  };
}

/**
 * Fetches the discovery document and logs why it failed. Never throws: the provider
 * may just be down, and users with a session keep working without it. An untrusted
 * certificate is a misconfiguration and logged as an error.
 */
export async function checkOidcDiscovery(discoveryUrl: string): Promise<void> {
  try {
    const res = await fetch(discoveryUrl, { signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS) });
    if (!res.ok) {
      log.warn(
        { discovery_url: discoveryUrl, status_code: res.status },
        'OIDC discovery failed: unexpected response from the provider'
      );
      return;
    }
    const metadata = (await res.json()) as Record<string, unknown>;
    if (typeof metadata.authorization_endpoint !== 'string') {
      log.warn(
        { discovery_url: discoveryUrl },
        'OIDC discovery failed: the response is no OIDC discovery document'
      );
      return;
    }
  } catch (err) {
    const details = describeFetchError(err);
    if (UNTRUSTED_CERTIFICATE_CODES.has(details.error_code ?? '')) {
      log.error(
        { discovery_url: discoveryUrl, ...details },
        'OIDC discovery failed: the provider certificate is not trusted; add its CA to STACKABLE_COCKPIT_TLS_CA_CERTS'
      );
    } else {
      log.warn({ discovery_url: discoveryUrl, ...details }, 'OIDC discovery failed');
    }
    return;
  }
  log.info({ discovery_url: discoveryUrl }, 'OIDC provider reachable');
}
