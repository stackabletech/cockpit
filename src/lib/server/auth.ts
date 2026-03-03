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

const usernameClaim = env.STACKABLE_UI_OIDC_USERNAME_CLAIM ?? 'preferred_username';

// OIDC is enabled only when all required OIDC env vars are present.
const oidcEnabled = !!(
  env.STACKABLE_UI_OIDC_DISCOVERY_URL &&
  env.STACKABLE_UI_OIDC_CLIENT_ID &&
  env.STACKABLE_UI_OIDC_CLIENT_SECRET
);

// Cache the OIDC discovery metadata (fetched once at startup) so the
// end_session_endpoint is available for logout without a per-request fetch.
export let oidcEndSessionEndpoint: string | undefined;

if (oidcEnabled) {
  try {
    const res = await fetch(env.STACKABLE_UI_OIDC_DISCOVERY_URL!);
    const discovery = await res.json();
    oidcEndSessionEndpoint = discovery.end_session_endpoint;
  } catch (err) {
    console.warn(
      'Failed to fetch OIDC discovery for end_session_endpoint, logout will be local-only:',
      err
    );
  }
}

export const auth = betterAuth({
  secret: env.STACKABLE_UI_SESSION_SECRET,
  baseURL: env.STACKABLE_UI_BASE_URL,
  database: new Database(env.STACKABLE_UI_SQLITE_PATH ?? '.data/auth.db'),
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
  plugins: oidcEnabled
    ? [
        genericOAuth({
          config: [
            {
              providerId: 'oidc',
              discoveryUrl: env.STACKABLE_UI_OIDC_DISCOVERY_URL,
              clientId: env.STACKABLE_UI_OIDC_CLIENT_ID!,
              clientSecret: env.STACKABLE_UI_OIDC_CLIENT_SECRET!,
              scopes: ['openid', 'profile', 'email'],
              pkce: true,
              mapProfileToUser: async (profile) => {
                const fullName = [profile.given_name, profile.family_name]
                  .filter(Boolean)
                  .join(' ');
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
    : []
});
