import { OAuth2Server } from 'oauth2-mock-server';

export const MOCK_OIDC_PORT = 9090;
export const ISSUER_URL = `http://localhost:${MOCK_OIDC_PORT}`;
export const DISCOVERY_URL = `${ISSUER_URL}/.well-known/openid-configuration`;

let server: OAuth2Server | null = null;

export async function startMockOidc(): Promise<string> {
  server = new OAuth2Server();

  await server.issuer.keys.generate('RS256');

  // Add OIDC profile claims to every issued token
  server.service.on('beforeTokenSigning', (token) => {
    token.payload.sub = 'mock-user-001';
    token.payload.name = 'Test User';
    token.payload.email = 'testuser@example.com';
    token.payload.preferred_username = 'testuser';
  });

  // Return the same claims from the userinfo endpoint
  server.service.on('beforeUserinfo', (response) => {
    response.body = {
      sub: 'mock-user-001',
      name: 'Test User',
      email: 'testuser@example.com',
      preferred_username: 'testuser'
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
