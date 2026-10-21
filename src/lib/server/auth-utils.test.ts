import { describe, it, expect, vi } from 'vitest';
import { findTrinoUser, getTrinoUser, getUserId } from './auth-utils.js';

describe('getUserId', () => {
  it('returns the user ID when user is present', () => {
    const locals = { user: { id: 'user-abc-123' } } as App.Locals;
    expect(getUserId(locals)).toBe('user-abc-123');
  });

  it('returns "anonymous" when user is undefined', () => {
    const locals = {} as App.Locals;
    expect(getUserId(locals)).toBe('anonymous');
  });

  it('returns "anonymous" when user has no id', () => {
    const locals = { user: {} } as App.Locals;
    expect(getUserId(locals)).toBe('anonymous');
  });
});

describe('getTrinoUser', () => {
  const logger = { error: vi.fn() };

  it('returns the username of the signed-in user', () => {
    const locals = { user: { id: 'u1', username: 'alice' }, logger } as unknown as App.Locals;
    expect(getTrinoUser(locals)).toBe('alice');
  });

  it('returns "anonymous" without a signed-in user (OIDC disabled)', () => {
    const locals = { user: null, logger } as unknown as App.Locals;
    expect(getTrinoUser(locals)).toBe('anonymous');
  });

  it('fails instead of falling back to "anonymous" when the username is missing', () => {
    const locals = { user: { id: 'u1', username: null }, logger } as unknown as App.Locals;
    expect(() => getTrinoUser(locals)).toThrow(expect.objectContaining({ status: 500 }));
    expect(logger.error).toHaveBeenCalledWith({ user_id: 'u1' }, expect.any(String));
  });
});

describe('findTrinoUser', () => {
  const logger = { error: vi.fn() };

  it('returns null instead of "anonymous" when the username is missing', () => {
    const locals = { user: { id: 'u1', username: null }, logger } as unknown as App.Locals;
    expect(findTrinoUser(locals)).toBeNull();
    expect(logger.error).toHaveBeenCalledWith({ user_id: 'u1' }, expect.any(String));
  });
});
