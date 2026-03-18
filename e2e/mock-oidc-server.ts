import { OAuth2Server } from 'oauth2-mock-server';

export const MOCK_OIDC_PORT = 9090;
export const ISSUER_URL = `http://localhost:${MOCK_OIDC_PORT}`;
export const DISCOVERY_URL = `${ISSUER_URL}/.well-known/openid-configuration`;

let server: OAuth2Server | null = null;

export async function startMockOidc(): Promise<string> {
  server = new OAuth2Server();

  await server.issuer.keys.generate('RS256');

  // Each auth flow gets a unique user so that parallel Playwright projects
  // (chromium, firefox, mobile) don't share the same server-side session
  // and Trino connection store entry.
  let userCounter = 0;
  let lastSub = 'mock-user-001';

  // Add OIDC profile claims to every issued token
  server.service.on('beforeTokenSigning', (token) => {
    userCounter++;
    lastSub = `mock-user-${String(userCounter).padStart(3, '0')}`;
    token.payload.sub = lastSub;
    token.payload.name = `Test User ${userCounter}`;
    token.payload.email = `testuser${userCounter}@example.com`;
    token.payload.preferred_username = `testuser${userCounter}`;
  });

  // Return the same claims from the userinfo endpoint
  server.service.on('beforeUserinfo', (response) => {
    response.body = {
      sub: lastSub,
      name: `Test User ${userCounter}`,
      email: `testuser${userCounter}@example.com`,
      preferred_username: `testuser${userCounter}`
    };
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
