import { betterAuth } from 'better-auth';
import { genericOAuth, openAPI } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import type { RequestEvent } from '@sveltejs/kit';

// Dynamic imports with fallbacks for non-SvelteKit contexts.
const envModule = await import('$env/dynamic/private').catch(() => null);
const appServer = await import('$app/server').catch(() => null);
const loggingModule = await import('$lib/server/logging').catch(() => null);

const env = envModule?.env ?? (process.env as Record<string, string | undefined>);
const getRequestEvent = appServer?.getRequestEvent ?? (() => undefined as unknown as RequestEvent);
const log = loggingModule?.logger.child({ module: 'auth' });

const trinoUserClaim = env.STACKABLE_COCKPIT_TRINO_USER_CLAIM ?? 'preferred_username';

const defaultScopes = ['openid', 'profile', 'email'];

const extraScopes = (env.STACKABLE_COCKPIT_OIDC_EXTRA_SCOPES ?? '')
  .split(/[\s,]+/)
  .map((scope) => scope.trim())
  .filter(Boolean);

const oidcScopes = [...new Set([...defaultScopes, ...extraScopes])];

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
                scopes: oidcScopes,
                pkce: true,
                mapProfileToUser: async (profile) => {
                  const fullName = [profile.given_name, profile.family_name]
                    .filter(Boolean)
                    .join(' ');
                  const trinoUser = profile[trinoUserClaim];
                  if (trinoUser) {
                    log?.debug(
                      { trino_user_claim: trinoUserClaim },
                      'Resolved Trino user from OIDC claim'
                    );
                  } else {
                    log?.warn(
                      { trino_user_claim: trinoUserClaim },
                      'Trino user claim missing from OIDC profile; falling back to preferred_username'
                    );
                  }
                  return {
                    name: profile.name || fullName || profile.preferred_username || profile.email,
                    email: profile.email || profile.preferred_username,
                    image: profile.picture || null,
                    username: trinoUser || profile.preferred_username || profile.email
                  };
                }
              }
            ]
          })
        ]
      : [])
  ]
});
