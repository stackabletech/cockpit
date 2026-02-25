import { betterAuth } from 'better-auth';
import { genericOAuth } from 'better-auth/plugins';
import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: new Database(env.DATABASE_PATH ?? '/data/auth.db'),
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 }
  },
  plugins: [
    genericOAuth({
      config: [
        {
          providerId: 'oidc',
          discoveryUrl: `${env.AUTH_ISSUER}/.well-known/openid-configuration`,
          clientId: env.AUTH_CLIENT_ID,
          clientSecret: env.AUTH_CLIENT_SECRET,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          mapProfileToUser: async (profile) => {
            const fullName = [profile.given_name, profile.family_name].filter(Boolean).join(' ');
            return {
              name: profile.name || fullName || profile.preferred_username || profile.email,
              email: profile.email || profile.preferred_username,
              image: profile.picture || null
            };
          }
        }
      ]
    })
  ]
});
