import { describe, expect, it, vi } from 'vitest';
import { parseAdditionalUserInputFromProviderProfile } from 'better-auth/db';
import { auth } from './auth.js';

const hooks = auth.options.databaseHooks!.user!;
const create = (data: Record<string, unknown>, path: string) =>
  hooks.create!.before!(data as never, { path } as never);
const update = (data: Record<string, unknown>, path: string) =>
  hooks.update!.before!(data as never, { path } as never);

describe('user.additionalFields.trinoUser', () => {
  it('is taken from the OIDC provider profile', () => {
    expect(
      parseAdditionalUserInputFromProviderProfile(auth.options, { trinoUser: 'alice' }, 'create')
    ).toMatchObject({ trinoUser: 'alice' });
  });

  it('may be written by the OIDC callback', async () => {
    await expect(
      create({ email: 'alice@example.com', trinoUser: 'alice' }, '/oauth2/callback/:providerId')
    ).resolves.toBeUndefined();
  });

  it('rejects a rewrite through the built-in update-user endpoint', async () => {
    await expect(update({ trinoUser: 'someone-else' }, '/update-user')).rejects.toThrow(
      /trinoUser is not allowed to be set/
    );
  });

  it('rejects a rewrite smuggled in at sign-up', async () => {
    await expect(
      create({ email: 'eve@example.com', trinoUser: 'someone-else' }, '/sign-up/email')
    ).rejects.toThrow(/trinoUser is not allowed to be set/);
  });

  it('leaves other user updates alone', async () => {
    await expect(update({ emailVerified: true }, '/update-user')).resolves.toBeUndefined();
  });
});

describe('OIDC configuration', () => {
  it('fails at startup when only some of the OIDC variables are set', async () => {
    vi.resetModules();
    vi.doMock('$env/dynamic/private', () => ({
      env: { STACKABLE_COCKPIT_OIDC_CLIENT_ID: 'cockpit' }
    }));
    try {
      await expect(import('./auth.js')).rejects.toThrow(/set all or none of/);
    } finally {
      vi.doUnmock('$env/dynamic/private');
      vi.resetModules();
    }
  });
});
