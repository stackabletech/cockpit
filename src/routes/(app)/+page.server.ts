import type { PageServerLoad } from './$types';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';

export type DashboardService = 'trino' | 'storage';

export const load: PageServerLoad = async (event) => {
  const log = event.locals.logger;

  log.debug('Loading dashboard data');

  // The Trino SQL editor is always available: either pre-configured via env
  // or connected per user through the connection form.
  const services: DashboardService[] = ['trino'];
  if (storageBrowserEnabled) {
    services.push('storage');
  }

  const healthy = true;

  log.debug({ services, healthy }, 'Dashboard loaded');

  return { services, healthy };
};
