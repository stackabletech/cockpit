import type { LayoutServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { getConnection } from '$lib/server/storage/service.js';
import { getUserId } from '$lib/server/auth-utils.js';
import { storageBrowserEnabled } from '$lib/server/feature-flags.js';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!storageBrowserEnabled) {
    throw error(404, 'Not found');
  }

  const userId = getUserId(locals);
  const connection = getConnection(userId);

  return {
    connected: connection !== null,
    connectionType: connection?.type ?? null
  };
};
