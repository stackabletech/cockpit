import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import Database from 'better-sqlite3';

// Use SvelteKit's $env when available, fall back to process.env for the
// better-auth CLI which imports this file outside of SvelteKit via jiti.
let env: Record<string, string | undefined>;
try {
  env = (await import('$env/dynamic/private')).env;
} catch {
  env = process.env as Record<string, string | undefined>;
}

function requireEnv(name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// Cache the OIDC discovery metadata (fetched once at startup) so the
// end_session_endpoint is available for logout without a per-request fetch.
export let oidcEndSessionEndpoint: string | undefined;

const discoveryUrl = requireEnv('STACKABLE_UI_OIDC_DISCOVERY_URL');
const usernameClaim = env.STACKABLE_UI_OIDC_USERNAME_CLAIM ?? 'preferred_username';

try {
  const res = await fetch(discoveryUrl);
  const discovery = await res.json();
  oidcEndSessionEndpoint = discovery.end_session_endpoint;
} catch {
  // Discovery fetch may fail during CLI migrations or when the IdP is
  // unreachable at startup. Logout will fall back to local-only sign-out.
}

export const auth = betterAuth({
  secret: requireEnv('STACKABLE_UI_SESSION_SECRET'),
  baseURL: requireEnv('STACKABLE_UI_BASE_URL'),
  database: new Database(requireEnv('STACKABLE_UI_SQLITE_PATH')),
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 }
  },
  user: {
    additionalFields: {
      username: {
        type: 'string',
        required: false
      }
    }
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: 'oidc',
          discoveryUrl: requireEnv('STACKABLE_UI_OIDC_DISCOVERY_URL'),
          clientId: requireEnv('STACKABLE_UI_OIDC_CLIENT_ID'),
          clientSecret: requireEnv('STACKABLE_UI_OIDC_CLIENT_SECRET'),
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          mapProfileToUser: async (profile) => {
            const fullName = [profile.given_name, profile.family_name].filter(Boolean).join(' ');
            return {
              name: profile.name || fullName || profile.preferred_username || profile.email,
              email: profile.email || profile.preferred_username,
              image: profile.picture || null,
              username: profile[usernameClaim] || profile.preferred_username || profile.email
            };
          }
        }
      ]
    })
  ]
});
