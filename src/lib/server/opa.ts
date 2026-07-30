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

const client = opaEnabled ? new OPAClient(opaUrl, { sdk: { timeoutMs: opaTimeout } }) : null;

export async function checkAdmin(input: OpaInput): Promise<boolean> {
  if (!client) {
    opaRequestDuration.observe({ outcome: 'disabled' }, 0);
    opaRequestTotal.inc({ outcome: 'disabled' });
    log.debug('OPA disabled, returning non-admin');
    return false;
  }

  const start = performance.now();
  try {
    const isAdmin = await client.evaluate<OpaInput, boolean>('stackable/admin', input, {
      fromResult: (r) => (r as Record<string, unknown>)?.admin === true
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
