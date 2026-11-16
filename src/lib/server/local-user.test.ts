import { describe, expect, it, vi } from 'vitest';
import type { User } from 'better-auth';
import { belongsToAuthMode, findOrCreateLocalUser, isLocalUser } from './local-user.js';

const localUser = {
  id: 'local',
  email: 'local-user@cockpit.invalid',
  name: 'Local user'
} as User;
const oidcUser = { id: 'u1', email: 'alice@example.com', name: 'Alice' } as User;

describe('isLocalUser', () => {
  it('recognises the local user by its email', () => {
    expect(isLocalUser(localUser)).toBe(true);
    expect(isLocalUser(oidcUser)).toBe(false);
  });
});

describe('belongsToAuthMode', () => {
  it('accepts only the local user without OIDC', () => {
    expect(belongsToAuthMode(localUser, false)).toBe(true);
    expect(belongsToAuthMode(oidcUser, false)).toBe(false);
  });

  it('rejects the local user with OIDC', () => {
    expect(belongsToAuthMode(localUser, true)).toBe(false);
    expect(belongsToAuthMode(oidcUser, true)).toBe(true);
  });
});

describe('findOrCreateLocalUser', () => {
  it('returns the existing local user without creating one', async () => {
    const store = {
      findUserByEmail: vi.fn().mockResolvedValue({ user: localUser }),
      createUser: vi.fn()
    };

    await expect(findOrCreateLocalUser(store)).resolves.toBe(localUser);
    expect(store.findUserByEmail).toHaveBeenCalledWith('local-user@cockpit.invalid');
    expect(store.createUser).not.toHaveBeenCalled();
  });

  it('creates the local user on first use', async () => {
    const store = {
      findUserByEmail: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockResolvedValue(localUser)
    };

    await expect(findOrCreateLocalUser(store)).resolves.toBe(localUser);
    expect(store.createUser).toHaveBeenCalledWith(
      { email: 'local-user@cockpit.invalid', name: 'Local user', emailVerified: false },
      { method: 'local-user' }
    );
  });

  it('returns the user a concurrent request created', async () => {
    const store = {
      findUserByEmail: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ user: localUser }),
      createUser: vi.fn().mockRejectedValue(new Error('duplicate key'))
    };

    await expect(findOrCreateLocalUser(store)).resolves.toBe(localUser);
  });

  it('rethrows when creating fails and no user exists', async () => {
    const store = {
      findUserByEmail: vi.fn().mockResolvedValue(null),
      createUser: vi.fn().mockRejectedValue(new Error('database down'))
    };

    await expect(findOrCreateLocalUser(store)).rejects.toThrow('database down');
  });
});
