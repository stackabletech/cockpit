import type { PageServerLoad } from './$types';

// The connections list is managed entirely in localStorage on the client.
// The server only provides an empty shell so the route is authenticated.
export const load: PageServerLoad = async ({ locals }) => {
  locals.logger.debug('loading storage connections management page');
  return {};
};
