import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
  const log = event.locals.logger;

  log.debug('Loading dashboard data');

  // Future: discover services via K8s API, fetch active queries from Trino
  const serviceCount = 0;
  const healthy = true;

  log.info({ service_count: serviceCount, healthy }, 'Dashboard loaded');

  return { serviceCount, healthy };
};
