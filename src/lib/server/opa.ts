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

interface OpaAdminDecision {
  result?: boolean;
}

export async function checkAdmin(input: OpaInput): Promise<boolean> {
  if (!opaEnabled) {
    opaRequestDuration.observe({ outcome: 'disabled' }, 0);
    opaRequestTotal.inc({ outcome: 'disabled' });
    log.debug('OPA disabled, returning non-admin');
    return false;
  }

  const start = performance.now();
  try {
    const res = await fetch(`${opaUrl}/v1/data/stackable/admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input }),
      signal: AbortSignal.timeout(opaTimeout)
    });

    const duration = (performance.now() - start) / 1000;
    opaRequestDuration.observe({ outcome: res.ok ? 'allow' : 'error' }, duration);

    if (!res.ok) {
      opaRequestTotal.inc({ outcome: 'error' });
      log.warn({ status_code: res.status, user_id: input.user.id }, 'OPA returned error');
      return false;
    }

    const data: OpaAdminDecision = await res.json();
    const isAdmin = data.result === true;

    opaRequestTotal.inc({ outcome: isAdmin ? 'allow' : 'deny' });
    log.debug({ user_id: input.user.id, is_admin: isAdmin }, 'OPA admin check');

    return isAdmin;
  } catch (err) {
    const duration = (performance.now() - start) / 1000;
    opaRequestDuration.observe({ outcome: 'error' }, duration);
    opaRequestTotal.inc({ outcome: 'error' });
    log.warn({ err, user_id: input.user.id }, 'OPA request failed');
    return false;
  }
}
