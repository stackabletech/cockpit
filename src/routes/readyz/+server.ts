import { oidcDiscoveryUrl, oidcEnabled } from '$lib/server/auth';
import { checkOidcDiscovery } from '$lib/server/oidc-discovery.js';
import type { RequestHandler } from './$types';

// Ready once the OIDC provider has been discovered; until then nobody could log in.
export const GET: RequestHandler = async () => {
  if (oidcEnabled && !(await checkOidcDiscovery(oidcDiscoveryUrl!))) {
    return new Response('OIDC provider unreachable', { status: 503 });
  }
  return new Response('ok', { status: 200 });
};
