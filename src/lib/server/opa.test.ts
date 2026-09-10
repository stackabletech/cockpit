import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/feature-flags.js', () => ({
  opaEnabled: true,
  opaUrl: 'http://opa.test:8181',
  opaTimeout: 1000
}));

const { inc, observe } = vi.hoisted(() => ({
  inc: vi.fn(),
  observe: vi.fn()
}));
vi.mock('$lib/server/metrics.js', () => ({
  opaRequestDuration: { observe },
  opaRequestTotal: { inc }
}));

import { checkAdmin, type OpaEvaluator } from './opa.js';
import { opaRequestDuration, opaRequestTotal } from './metrics.js';

const input = {
  user: { id: 'user-1', email: 'alice@example.com', username: 'alice' }
};

const fakeEvaluator = (impl: (path: string, input: unknown) => Promise<unknown>): OpaEvaluator => ({
  async evaluate(path, inp, { fromResult }) {
    return fromResult(await impl(path, inp));
  }
});

describe('checkAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns false and records disabled outcome when no evaluator is available', async () => {
    await expect(checkAdmin(input, null)).resolves.toBe(false);

    expect(opaRequestTotal.inc).toHaveBeenCalledWith({ outcome: 'disabled' });
    expect(opaRequestDuration.observe).toHaveBeenCalledWith({ outcome: 'disabled' }, 0);
  });

  it('returns true when the policy result is a bare boolean true', async () => {
    const evaluator = fakeEvaluator(async (path) => {
      expect(path).toBe('stackable/admin');
      return true;
    });

    await expect(checkAdmin(input, evaluator)).resolves.toBe(true);

    expect(opaRequestTotal.inc).toHaveBeenCalledWith({ outcome: 'allow' });
    expect(opaRequestDuration.observe).toHaveBeenCalledWith(
      { outcome: 'allow' },
      expect.any(Number)
    );
  });

  it('returns false when the policy result is a bare boolean false', async () => {
    const evaluator = fakeEvaluator(async () => false);

    await expect(checkAdmin(input, evaluator)).resolves.toBe(false);

    expect(opaRequestTotal.inc).toHaveBeenCalledWith({ outcome: 'deny' });
    expect(opaRequestDuration.observe).toHaveBeenCalledWith(
      { outcome: 'deny' },
      expect.any(Number)
    );
  });

  it('returns true when the policy result is an object with admin: true', async () => {
    const evaluator = fakeEvaluator(async () => ({ admin: true }));

    await expect(checkAdmin(input, evaluator)).resolves.toBe(true);
  });

  it('returns false when the policy result is an object without admin', async () => {
    const evaluator = fakeEvaluator(async () => ({ admin: false }));

    await expect(checkAdmin(input, evaluator)).resolves.toBe(false);
  });

  it('forwards the user input to the evaluator', async () => {
    const evaluate = vi.fn(async () => true);
    const evaluator = { evaluate } as unknown as OpaEvaluator;

    await checkAdmin(input, evaluator);

    expect(evaluate).toHaveBeenCalledWith('stackable/admin', input, expect.anything());
  });

  it('fails closed and records an error outcome when the evaluator rejects', async () => {
    const evaluator = fakeEvaluator(async () => {
      throw new Error('OPA unreachable');
    });

    await expect(checkAdmin(input, evaluator)).resolves.toBe(false);

    expect(opaRequestTotal.inc).toHaveBeenCalledWith({ outcome: 'error' });
    expect(opaRequestDuration.observe).toHaveBeenCalledWith(
      { outcome: 'error' },
      expect.any(Number)
    );
  });
});
