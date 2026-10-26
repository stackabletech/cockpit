import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkSession, sessionState } from './session.svelte.js';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('$lib/auth-client', () => ({ authClient: { getSession } }));

describe('checkSession', () => {
  beforeEach(() => {
    getSession.mockReset();
    sessionState.active = true;
    sessionState.expired = false;
  });

  it('marks the session expired when the server reports no session', async () => {
    getSession.mockResolvedValue({ data: null, error: null });

    await checkSession();

    expect(sessionState.expired).toBe(true);
    expect(getSession).toHaveBeenCalledWith({ query: { disableRefresh: true } });
  });

  it('keeps the session when the server returns one', async () => {
    getSession.mockResolvedValue({ data: { user: {}, session: {} }, error: null });

    await checkSession();

    expect(sessionState.expired).toBe(false);
  });

  it('clears the flag once the session is restored', async () => {
    sessionState.expired = true;
    getSession.mockResolvedValue({ data: { user: {}, session: {} }, error: null });

    await checkSession();

    expect(sessionState.expired).toBe(false);
  });

  it('ignores server and network errors', async () => {
    getSession.mockResolvedValueOnce({ data: null, error: { status: 500 } });
    getSession.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await checkSession();
    await checkSession();

    expect(sessionState.expired).toBe(false);
  });

  it('shares one request between concurrent checks', async () => {
    getSession.mockResolvedValue({ data: { user: {}, session: {} }, error: null });

    await Promise.all([checkSession(), checkSession(), checkSession()]);

    expect(getSession).toHaveBeenCalledTimes(1);
  });

  it('does nothing while inactive', async () => {
    sessionState.active = false;

    await checkSession();

    expect(getSession).not.toHaveBeenCalled();
    expect(sessionState.expired).toBe(false);
  });
});
