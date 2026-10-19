import type { LayoutServerLoad } from './$types';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  return { user: locals.user, storageBrowserEnabled };
};
