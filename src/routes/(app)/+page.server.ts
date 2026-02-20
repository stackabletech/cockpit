import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const log = event.locals.logger;

  log.debug('Loading dashboard data');

  // This is just mock data to show how to log structured data/fields
  const serviceCount = 0;
  const healthy = true;

  log.info({ service_count: serviceCount, healthy }, 'Dashboard loaded');

  return { serviceCount, healthy };
};
