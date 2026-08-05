import { betterAuth } from 'better-auth';
import { genericOAuth, openAPI } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import type { RequestEvent } from '@sveltejs/kit';

// Dynamic imports with fallbacks for non-SvelteKit contexts.
const envModule = await import('$env/dynamic/private').catch(() => null);
const appServer = await import('$app/server').catch(() => null);
const environmentModule = await import('$app/environment').catch(() => null);

const env = envModule?.env ?? (process.env as Record<string, string | undefined>);
const getRequestEvent = appServer?.getRequestEvent ?? (() => undefined as unknown as RequestEvent);
const dev = environmentModule?.dev ?? process.env.NODE_ENV !== 'production';

const usernameClaim = env.STACKABLE_COCKPIT_OIDC_USERNAME_CLAIM ?? 'preferred_username';

// OIDC is enabled only when all required OIDC env vars are present.
export const oidcEnabled = !!(
  env.STACKABLE_COCKPIT_OIDC_DISCOVERY_URL &&
  env.STACKABLE_COCKPIT_OIDC_CLIENT_ID &&
  env.STACKABLE_COCKPIT_OIDC_CLIENT_SECRET
);

export const auth = betterAuth({
  secret: env.STACKABLE_COCKPIT_SESSION_SECRET,
  baseURL: dev
    ? {
        allowedHosts: ['localhost:*', '127.0.0.1:*', '[::1]:*'],
        fallback: env.STACKABLE_COCKPIT_BASE_URL
      }
    : env.STACKABLE_COCKPIT_BASE_URL,
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
