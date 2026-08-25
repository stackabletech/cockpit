import { configuredEmbeddedServices } from '$lib/server/embedded-services.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = () => {
  return { embeddedServices: configuredEmbeddedServices() };
};
