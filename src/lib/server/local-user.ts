import type { BetterAuthPlugin, User } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';

/**
 * Without OIDC every request acts as this one user, so per-user features
 * (storage connections, bookmarks, recent searches) work and are shared by
 * everyone who can reach the instance. `.invalid` is reserved and never routes.
 */
const LOCAL_USER_EMAIL = 'local-user@cockpit.invalid';
const LOCAL_USER_NAME = 'Local user';

export function isLocalUser(user: Pick<User, 'email'>): boolean {
  return user.email === LOCAL_USER_EMAIL;
}

/**
 * Whether a session of this user is valid in the current auth mode: the local
 * user only without OIDC, every other user only with it. Sessions survive a
 * mode switch, so a browser would otherwise keep acting as the local user
 * after OIDC is enabled (skipping the login), or as its own OIDC user after
 * it is disabled.
 */
export function belongsToAuthMode(user: Pick<User, 'email'>, oidcEnabled: boolean): boolean {
  return isLocalUser(user) !== oidcEnabled;
}

/** The part of better-auth's internal adapter the local user needs. */
interface LocalUserStore {
  findUserByEmail(email: string): Promise<{ user: User } | null>;
  createUser(
    user: { email: string; name: string; emailVerified: boolean },
    source: { method: 'local-user' }
  ): Promise<User>;
}

/** The local user, created on first use. */
export async function findOrCreateLocalUser(store: LocalUserStore): Promise<User> {
  const find = async () => (await store.findUserByEmail(LOCAL_USER_EMAIL))?.user ?? null;

  const existing = await find();
  if (existing) return existing;
  try {
    return await store.createUser(
      { email: LOCAL_USER_EMAIL, name: LOCAL_USER_NAME, emailVerified: false },
      { method: 'local-user' }
    );
  } catch (err) {
    // A concurrent first request created it; the email is unique.
    const created = await find();
    if (created) return created;
    throw err;
  }
}

/**
 * better-auth plugin with a server-only endpoint (`auth.api.signInLocalUser`)
 * that starts a session for the local user. It is not reachable over HTTP and
 * only registered when OIDC is disabled.
 */
export const localUser = () =>
  ({
    id: 'local-user',
    endpoints: {
      signInLocalUser: createAuthEndpoint.serverOnly({ method: 'POST' }, async (ctx) => {
        const adapter = ctx.context.internalAdapter;
        const user = await findOrCreateLocalUser(adapter);
        const session = await adapter.createSession(user.id);
        if (!session) throw new APIError('INTERNAL_SERVER_ERROR');
        await setSessionCookie(ctx, { session, user });
        return ctx.json({ user, session });
      })
    }
  }) satisfies BetterAuthPlugin;
