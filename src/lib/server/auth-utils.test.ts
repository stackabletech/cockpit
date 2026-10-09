import { describe, it, expect } from 'vitest';
import { getUserId } from './auth-utils.js';

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
