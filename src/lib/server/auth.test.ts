import { describe, expect, it } from 'vitest';
import { parseUserInput } from 'better-auth/db';
import { auth } from './auth.js';

describe('user.additionalFields.username', () => {
  it('rejects a rewrite through the built-in update-user endpoint', () => {
    expect(() => parseUserInput(auth.options, { username: 'someone-else' }, 'update')).toThrow(
      /username is not allowed to be set/
    );
  });

  it('rejects a rewrite smuggled in at sign-up', () => {
    expect(() => parseUserInput(auth.options, { username: 'someone-else' }, 'create')).toThrow(
      /username is not allowed to be set/
    );
  });

  it('is still declared, so the OIDC claim can populate it', () => {
    expect(auth.options.user?.additionalFields?.username).toMatchObject({ type: 'string' });
  });
});
