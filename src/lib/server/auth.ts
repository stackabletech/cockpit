import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { genericOAuth, openAPI } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import type { RequestEvent } from '@sveltejs/kit';
import { db } from './db.js';
import * as schema from './auth-schema.js';

// Dynamic imports with fallbacks for non-SvelteKit contexts.
const envModule = await import('$env/dynamic/private').catch(() => null);
const appServer = await import('$app/server').catch(() => null);
const loggingModule = await import('$lib/server/logging').catch(() => null);

const env = envModule?.env ?? (process.env as Record<string, string | undefined>);
const getRequestEvent = appServer?.getRequestEvent ?? (() => undefined as unknown as RequestEvent);
const log = loggingModule?.logger.child({ module: 'auth' });

// trinoUser is the Trino user we impersonate, so only the OIDC callback may
// write it. Marking the field `input: false` would also block that: better-auth
// drops such fields from the provider profile on sign-up (see #371). Database
// hooks see the endpoint's route template, not the request path.
const trinoUserWritePath = '/oauth2/callback/:providerId';

function guardTrinoUserWrite(data: Record<string, unknown>, context: { path?: string } | null) {
  if (!('trinoUser' in data) || context?.path === trinoUserWritePath) return;
  log?.warn({ path: context?.path }, 'Rejected trinoUser write outside the OIDC callback');
  throw new APIError('FORBIDDEN', { message: 'trinoUser is not allowed to be set' });
}

const trinoUserClaim = env.STACKABLE_COCKPIT_TRINO_USER_CLAIM ?? 'preferred_username';

const defaultScopes = ['openid', 'profile', 'email'];

const extraScopes = (env.STACKABLE_COCKPIT_OIDC_EXTRA_SCOPES ?? '')
  .split(/[\s,]+/)
  .map((scope) => scope.trim())
  .filter(Boolean);

const oidcScopes = [...new Set([...defaultScopes, ...extraScopes])];

// OIDC profile claims are untyped; only non-empty strings are usable.
const claim = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

// OIDC is enabled only when all required OIDC env vars are present.
export const oidcEnabled = !!(
  env.STACKABLE_COCKPIT_OIDC_DISCOVERY_URL &&
  env.STACKABLE_COCKPIT_OIDC_CLIENT_ID &&
  env.STACKABLE_COCKPIT_OIDC_CLIENT_SECRET
);

export const auth = betterAuth({
  secret: env.STACKABLE_COCKPIT_SESSION_SECRET,
  baseURL: env.STACKABLE_COCKPIT_BASE_URL,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ['oidc']
    }
  },
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
    additionalFields: {
      activeStorageConnectionId: {
        type: 'string',
        required: false,
        defaultValue: null
      }
    }
  },
  user: {
    additionalFields: {
      trinoUser: {
        type: 'string',
        required: false
      }
    }
  },
  databaseHooks: {
    user: {
      create: { before: async (user, context) => guardTrinoUserWrite(user, context) },
      update: { before: async (user, context) => guardTrinoUserWrite(user, context) }
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
                // Refresh the user from the IdP on every login, so changes to the
                // Trino user claim reach existing users instead of only new ones.
                overrideUserInfo: true,
                mapProfileToUser: async (profile) => {
                  const fullName = [claim(profile.given_name), claim(profile.family_name)]
                    .filter(Boolean)
                    .join(' ');
                  const preferredUsername = claim(profile.preferred_username);
                  const email = claim(profile.email);
                  const claimedTrinoUser = claim(profile[trinoUserClaim]);
                  if (claimedTrinoUser) {
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
                    name: claim(profile.name) || fullName || preferredUsername || email,
                    email: email ?? '',
                    emailVerified: profile.email_verified === true,
                    image: claim(profile.picture),
                    // No `|| ''`: without an email better-auth rejects the sign-in before
                    // creating the user, so this never stores an empty Trino user.
                    trinoUser: claimedTrinoUser || preferredUsername || email
                  };
                }
              }
            ]
          })
        ]
      : [])
  ]
});
