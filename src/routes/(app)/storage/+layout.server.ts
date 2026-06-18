import type { LayoutServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!storageBrowserEnabled) {
    throw error(404, 'Not found');
  }

  locals.logger.debug('loading storage layout');

  // Connected state and bucket list are determined client-side from localStorage
  // and populated by the universal +layout.ts load after hydration.
  return { connected: false, buckets: [] as string[], connectionType: null };
};
