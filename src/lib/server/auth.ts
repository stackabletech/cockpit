import { betterAuth } from 'better-auth';
import { genericOAuth, openAPI } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import type { RequestEvent } from '@sveltejs/kit';

// Dynamic imports with fallbacks for non-SvelteKit contexts.
const envModule = await import('$env/dynamic/private').catch(() => null);
const appServer = await import('$app/server').catch(() => null);

const env = envModule?.env ?? (process.env as Record<string, string | undefined>);
const getRequestEvent = appServer?.getRequestEvent ?? (() => undefined as unknown as RequestEvent);

const usernameClaim = env.STACKABLE_COCKPIT_OIDC_USERNAME_CLAIM ?? 'preferred_username';

// Cockpit's session lifetime (seconds). Per iframe-spike §4.6 this should be the SHORTEST clock in
// the platform, so expiry surfaces at the top level (where the IdP can render) before an embedded
// product's in-frame session lapses. Defaults to 7 days; override to tune the invariant.
const sessionMaxAge = Number(env.STACKABLE_COCKPIT_SESSION_MAX_AGE_SECONDS) || 60 * 60 * 24 * 7;

// OIDC is enabled only when all required OIDC env vars are present.
export const oidcEnabled = !!(
  env.STACKABLE_COCKPIT_OIDC_DISCOVERY_URL &&
  env.STACKABLE_COCKPIT_OIDC_CLIENT_ID &&
  env.STACKABLE_COCKPIT_OIDC_CLIENT_SECRET
);

export const auth = betterAuth({
  secret: env.STACKABLE_COCKPIT_SESSION_SECRET,
  baseURL: env.STACKABLE_COCKPIT_BASE_URL,
  session: {
    expiresIn: sessionMaxAge,
    updateAge: sessionMaxAge,
    cookieCache: { enabled: true, maxAge: Math.min(5 * 60, sessionMaxAge) }
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
    sveltekitCookies(getRequestEvent),
    openAPI(),
    ...(oidcEnabled
      ? [
          genericOAuth({
            config: [
              {
                providerId: 'oidc',
                discoveryUrl: env.STACKABLE_COCKPIT_OIDC_DISCOVERY_URL,
                clientId: env.STACKABLE_COCKPIT_OIDC_CLIENT_ID!,
                clientSecret: env.STACKABLE_COCKPIT_OIDC_CLIENT_SECRET!,
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
      : [])
  ]
});
