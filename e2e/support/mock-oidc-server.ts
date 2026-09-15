import { OAuth2Server } from 'oauth2-mock-server';

export const MOCK_OIDC_PORT = 9090;
export const ISSUER_URL = `http://localhost:${MOCK_OIDC_PORT}`;
export const DISCOVERY_URL = `${ISSUER_URL}/.well-known/openid-configuration`;

/**
 * Cookie that a test can set (on the `localhost` domain, shared by the app and
 * the mock OIDC) to choose which profile the next sign-in gets. Values:
 * `admin` or `regular`. This makes the identity of each auth flow
 * deterministic without relying on login order.
 */
export const PROFILE_COOKIE = 'mock-oidc-profile';

export type OidcProfile = 'admin' | 'regular';

let server: OAuth2Server | null = null;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1];
  return JSON.parse(Buffer.from(base64, 'base64url').toString());
}

function getCookie(header: string | undefined, name: string): string | undefined {
  const needle = `${name}=`;
  const part = (header ?? '')
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(needle));
  return part ? part.slice(needle.length) : undefined;
}

export async function startMockOidc(): Promise<string> {
  server = new OAuth2Server();

  await server.issuer.keys.generate('RS256');

  // Each auth flow gets a unique user so that parallel Playwright projects
  // (chromium, firefox, mobile, admin) don't share the same server-side
  // session and Trino connection store entry.
  let userCounter = 0;

  // Map sub → profile claims so the userinfo endpoint can look them up
  // from the access token instead of relying on shared mutable state.
  const users = new Map<string, { name: string; email: string; preferred_username: string }>();

  // The requested profile travels from the browser's /authorize request (which
  // carries the test's cookie) to the token endpoint via the authorization
  // code. `beforeTokenSigning` fires for both the access and the id token, so
  // the map entry is deliberately not consumed/removed.
  const profilesByCode = new Map<string, OidcProfile>();

  // Capture the profile requested by the test on the /authorize request.
  server.service.on('beforeAuthorizeRedirect', (redirect, req) => {
    const cookie = getCookie(
      (req as { headers: { cookie?: string } }).headers.cookie,
      PROFILE_COOKIE
    );
    const code = redirect.url.searchParams.get('code');
    if (code) profilesByCode.set(code, cookie === 'admin' ? 'admin' : 'regular');
  });

  // Add OIDC profile claims to every issued token
  server.service.on('beforeTokenSigning', (token, req) => {
    userCounter++;
    const profile =
      profilesByCode.get((req as { body?: { code?: string } }).body?.code ?? '') ?? 'regular';
    const isAdmin = profile === 'admin';
    const n = userCounter;
    const sub = `mock-user-${String(n).padStart(3, '0')}`;
    const claims = {
      name: isAdmin ? `Admin User ${n}` : `Test User ${n}`,
      email: isAdmin ? `admin${n}@admin.example.com` : `testuser${n}@example.com`,
      preferred_username: isAdmin ? `admin${n}` : `testuser${n}`
    };
    users.set(sub, claims);
    token.payload.sub = sub;
    Object.assign(token.payload, claims);
  });

  // Return claims from the userinfo endpoint, derived from the access token
  // so concurrent auth flows don't interfere with each other.
  server.service.on('beforeUserinfo', (response, req) => {
    const auth = (req as { headers: Record<string, string> }).headers.authorization ?? '';
    const accessToken = auth.replace(/^Bearer\s+/i, '');

    try {
      const payload = decodeJwtPayload(accessToken);
      const sub = payload.sub as string;
      const profile = users.get(sub);
      if (profile) {
        response.body = { sub, ...profile };
        return;
      }
    } catch {
      // Fall through to default
    }

    response.body = { sub: 'unknown', name: 'Unknown User' };
  });

  await server.start(MOCK_OIDC_PORT, 'localhost');
  console.log(`Mock OIDC server started at ${ISSUER_URL}`);

  return ISSUER_URL;
}

export async function stopMockOidc(): Promise<void> {
  if (server) {
    await server.stop();
    server = null;
    console.log('Mock OIDC server stopped');
  }
}
