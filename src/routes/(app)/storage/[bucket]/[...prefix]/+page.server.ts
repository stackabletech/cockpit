import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
  const activeId = locals.session?.activeStorageConnectionId ?? null;
  if (!activeId) {
    throw redirect(303, '/storage');
  }

  const prefix = params.prefix ? params.prefix + '/' : '';
  const bucket = params.bucket;
  return { bucket, prefix, activeConnectionId: activeId };
};
