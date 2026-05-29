import { OAuth2Server } from 'oauth2-mock-server';

export const MOCK_OIDC_PORT = 9090;
export const ISSUER_URL = `http://localhost:${MOCK_OIDC_PORT}`;
export const DISCOVERY_URL = `${ISSUER_URL}/.well-known/openid-configuration`;

let server: OAuth2Server | null = null;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const base64 = token.split('.')[1];
  return JSON.parse(Buffer.from(base64, 'base64url').toString());
}

export async function startMockOidc(): Promise<string> {
  server = new OAuth2Server();

  await server.issuer.keys.generate('RS256');

  // Each auth flow gets a unique user so that parallel Playwright projects
  // (chromium, firefox, mobile) don't share the same server-side session
  // and Trino connection store entry.
  let userCounter = 0;

  // Map sub → profile claims so the userinfo endpoint can look them up
  // from the access token instead of relying on shared mutable state.
  const users = new Map<string, { name: string; email: string; preferred_username: string }>();

  // Add OIDC profile claims to every issued token
  server.service.on('beforeTokenSigning', (token) => {
    userCounter++;
    const sub = `mock-user-${String(userCounter).padStart(3, '0')}`;
    const profile = {
      name: `Test User ${userCounter}`,
      email: `testuser${userCounter}@example.com`,
      preferred_username: `testuser${userCounter}`
    };
    users.set(sub, profile);
    token.payload.sub = sub;
    Object.assign(token.payload, profile);
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
