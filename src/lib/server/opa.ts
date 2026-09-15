import { OPAClient } from '@open-policy-agent/opa';
import { logger } from '$lib/server/logging';
import { opaEnabled, opaUrl, opaTimeout } from './feature-flags.js';
import { opaRequestDuration, opaRequestTotal } from './metrics.js';

const log = logger.child({ module: 'opa-client' });

interface OpaInput {
  user: {
    id: string;
    email: string;
    username: string | null;
  };
}

/** Minimal surface of the OPA SDK client used by `checkAdmin`. Kept narrow so
 *  unit tests can inject a fake evaluator without a running OPA server. */
export interface OpaEvaluator {
  evaluate<Input, Result>(
    path: string,
    input: Input,
    opts: { fromResult: (result: unknown) => Result }
  ): Promise<Result>;
}

const client: OpaEvaluator | null = opaEnabled
  ? (new OPAClient(opaUrl, { sdk: { timeoutMs: opaTimeout } }) as unknown as OpaEvaluator)
  : null;

/**
 * Evaluate the `stackable/admin` policy for a user.
 *
 * Fail-closed: returns `false` when OPA is disabled, denies, or errors.
 * The `evaluator` parameter defaults to the module-level singleton so tests
 * can pass a fake client and exercise every outcome branch.
 */
export async function checkAdmin(
  input: OpaInput,
  evaluator: OpaEvaluator | null = client
): Promise<boolean> {
  if (!evaluator) {
    opaRequestDuration.observe({ outcome: 'disabled' }, 0);
    opaRequestTotal.inc({ outcome: 'disabled' });
    log.debug('OPA disabled, returning non-admin');
    return false;
  }

  const start = performance.now();
  try {
    const isAdmin = await evaluator.evaluate<OpaInput, boolean>('stackable/admin', input, {
      fromResult: (r) => r === true || (r as Record<string, unknown>)?.admin === true
    });

    const duration = (performance.now() - start) / 1000;
    opaRequestDuration.observe({ outcome: isAdmin ? 'allow' : 'deny' }, duration);
    opaRequestTotal.inc({ outcome: isAdmin ? 'allow' : 'deny' });
    log.debug({ user_id: input.user.id, is_admin: isAdmin }, 'OPA admin check');

    return isAdmin;
  } catch (err: unknown) {
    const duration = (performance.now() - start) / 1000;
    opaRequestDuration.observe({ outcome: 'error' }, duration);
    opaRequestTotal.inc({ outcome: 'error' });
    log.warn({ err, user_id: input.user.id }, 'OPA request failed');
    return false;
  }
}
