import { getUserId } from '$lib/server/auth-utils.js';
import { getAllQuerySummaries } from '$lib/server/trino/queries.js';
import { trinoConfigured } from '$lib/server/trino/client.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading Trino page');
  const userId = getUserId(locals);
  const activeQueries = getAllQuerySummaries(userId);
  return { activeQueries, trinoConfigured };
};
