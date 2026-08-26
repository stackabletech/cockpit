import { trinoConfigured } from '$lib/server/trino/client.js';
import { getUserTrinoClient } from '$lib/server/trino/user-clients.js';
import { getUserId } from '$lib/server/auth-utils.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading SQL diagram page');
  const userClientExists = getUserTrinoClient(getUserId(locals)) !== null;
  return { trinoConfigured, userClientExists };
};
